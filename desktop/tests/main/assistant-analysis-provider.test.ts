// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
const counter = vi.hoisted(() => ({}));
vi.mock('../../../src/runtime/sol-pi/deepseek-capacity-profile.js', () => ({
  isFrozenDeepSeekCounter: (value: unknown) => value === counter,
  countDeepSeekSerializedRequest: (_: unknown, body: string) => {
    const request = JSON.parse(body);
    if (request.thinking?.type !== 'disabled' || request.messages.length !== 2) throw Error('bad request');
    return 41;
  },
}));
import { createDesktopAssistantAnalysisProvider, checkDesktopAssistantAnalysisProviderSupport } from '../../electron/assistant-analysis-provider.js';
const config = {schemaVersion:2, defaultModelId:'selected', providers:{deepseek:{type:'first_party',protocol:'openai_legacy',apiKey:'test-only',baseUrl:'https://api.deepseek.com'}},models:{selected:{provider:'deepseek',model:'deepseek-flash'}}};
const make = () => createDesktopAssistantAnalysisProvider({config:config as never,modelId:'selected',counter:counter as never,timeoutMs:1000});
const request = {attemptId:'attempt-1',systemPrompt:'system',userMessage:'user',maxOutputTokens:100};
function response(finish: string | null = 'stop', usage: unknown = {prompt_tokens:41,completion_tokens:2,total_tokens:43}) {
  const chunks = [
    {id:'x',object:'chat.completion.chunk',choices:[{index:0,delta:{content:'OK'},finish_reason:null}]},
    {id:'x',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:finish}]},
    {id:'x',object:'chat.completion.chunk',choices:[],usage},
  ];
  return new Response(chunks.map(c=>`data: ${JSON.stringify(c)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
afterEach(()=>vi.unstubAllGlobals());
describe('concrete assistant analysis provider',()=>{
  it('measures the full request asynchronously through the frozen recipe',async()=>{
    const port=make();
    const measured=port.measureInput(request);
    expect(measured).toBeInstanceOf(Promise);
    expect(await measured).toBe(41);
  });
  it('uses the real adapter/SDK, hard max_tokens, disabled thinking and final native usage',async()=>{
    const fetch=vi.fn(async()=>response());vi.stubGlobal('fetch',fetch);
    const port=make();await port.measureInput(request);
    expect(await port.complete(request)).toEqual({text:'OK',finish:'complete',usage:{inputTokens:41,outputTokens:2}});
    expect(fetch).toHaveBeenCalledTimes(1);
    const init=fetch.mock.calls[0] as unknown as [unknown,{body:string}];
    const body=JSON.parse(init[1].body);
    expect(body.max_tokens).toBe(100);expect(body.thinking).toEqual({type:'disabled'});expect(body.tools).toBeUndefined();
  });
  it.each([402,429,500])('never retries HTTP %s and redacts response text',async status=>{
    const fetch=vi.fn(async()=>new Response('credential-secret',{status}));vi.stubGlobal('fetch',fetch);
    const port=make();await port.measureInput(request);
    await expect(port.complete(request)).rejects.toMatchObject({code:'ASSISTANT_ANALYSIS_PROVIDER_FAILURE',status});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps missing usage unknown instead of using adapter estimates',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>response('stop',null)));
    const port=make();await port.measureInput(request);
    expect((await port.complete(request)).usage).toBe('unknown');
  });
  it('maps output token truncation',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>response('length')));
    const port=make();await port.measureInput(request);
    expect((await port.complete(request)).finish).toBe('truncated');
  });
  it('rejects missing native terminal without retry',async()=>{
    const fetch=vi.fn(async()=>response(null));vi.stubGlobal('fetch',fetch);
    const port=make();await port.measureInput(request);
    await expect(port.complete(request)).rejects.toThrow('ASSISTANT_ANALYSIS_PROVIDER_FAILURE');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('refuses unmeasured, changed or replayed attempts before network',async()=>{
    const fetch=vi.fn(async()=>response());vi.stubGlobal('fetch',fetch);
    const port=make();await expect(port.complete(request)).rejects.toThrow();
    await port.measureInput(request);
    await expect(port.complete({...request,userMessage:'changed'})).rejects.toThrow();
    await port.complete(request);await expect(port.complete(request)).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('handles already-aborted input without dispatch',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const port=make();await port.measureInput(request);
    expect((await port.complete({...request,signal:AbortSignal.abort()})).finish).toBe('cancelled');expect(fetch).not.toHaveBeenCalled();
  });
  it('aborts an in-flight request without retry',async()=>{
    const controller=new AbortController();
    const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      init?.signal?.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});
      controller.abort();
    }));
    vi.stubGlobal('fetch',fetch);const port=make();await port.measureInput(request);
    expect((await port.complete({...request,signal:controller.signal})).finish).toBe('cancelled');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('times out the real SDK request and never retries',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      init?.signal?.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')),{once:true});
    })));
    const port=createDesktopAssistantAnalysisProvider({config:config as never,modelId:'selected',counter:counter as never,timeoutMs:10});
    await port.measureInput(request);expect((await port.complete(request)).finish).toBe('timeout');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['stop','length'])('rejects usage exceeding the input reserve even on %s',async finish=>{
    vi.stubGlobal('fetch',vi.fn(async()=>response(finish,{prompt_tokens:42,completion_tokens:2,total_tokens:44})));
    const port=make();await port.measureInput(request);
    await expect(port.complete(request)).rejects.toMatchObject({code:'ASSISTANT_ANALYSIS_PROVIDER_CONTRACT_BREACH',usage:{inputTokens:42,outputTokens:2}});
  });
  it('aborts a broken SDK stream before application retry',async()=>{
    const fetch=vi.fn(async()=>new Response(new ReadableStream({start(controller){controller.error(Error('credential-secret network failure'));}}),{headers:{'content-type':'text/event-stream'}}));
    vi.stubGlobal('fetch',fetch);const port=make();await port.measureInput(request);
    await expect(port.complete(request)).rejects.toThrow('ASSISTANT_ANALYSIS_PROVIDER_FAILURE');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('supports officially mapped configured aliases without changing wire model',async()=>{
    const alias=structuredClone(config);alias.models.selected.model='deepseek-v4-flash-vision-exp';
    expect(checkDesktopAssistantAnalysisProviderSupport(alias as never,'selected')).toMatchObject({supported:true,model:'deepseek-v4-flash-vision-exp'});
    const port=createDesktopAssistantAnalysisProvider({config:alias as never,modelId:'selected',counter:counter as never});
    const fetch=vi.fn(async()=>response());vi.stubGlobal('fetch',fetch);await port.measureInput(request);
    await port.complete(request);
    const call=fetch.mock.calls[0] as unknown as [unknown,{body:string}];expect(JSON.parse(call[1].body).model).toBe('deepseek-v4-flash-vision-exp');
    expect(port.contract.model).toBe('deepseek-v4-flash-vision-exp');expect(port.contract.id).not.toBe(make().contract.id);
  });
  it('does not infer a wire model from an empty configured entry',()=>{
    const missing=structuredClone(config);missing.models.selected.model='';
    expect(checkDesktopAssistantAnalysisProviderSupport(missing as never,'selected').supported).toBe(false);
  });
  it('rejects unknown provider, missing explicit model and forged counter',()=>{
    expect(()=>createDesktopAssistantAnalysisProvider({config:config as never,modelId:'missing',counter:counter as never})).toThrow();
    expect(()=>createDesktopAssistantAnalysisProvider({config:config as never,modelId:'selected',counter:{} as never})).toThrow();
    const other=structuredClone(config);other.models.selected.model='qwen3.8-flash-next';
    expect(()=>createDesktopAssistantAnalysisProvider({config:other as never,modelId:'selected',counter:counter as never})).toThrow();
  });
});
