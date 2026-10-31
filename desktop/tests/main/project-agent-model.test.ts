import {createKimiTerminalBoundaryError} from '../../../src/ai/runtime/kimi-terminal-boundary.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import {buildOpenAIAdapterInit} from '../../../src/ai/models.js';
import { describe, it, expect, vi } from 'vitest';
import { createProjectAgentModel, validateProjectAgentModelSelection } from '../../electron/project-agent-model.js';
import { DEFAULT_CONFIG, type Config, type ModelAdapter, type StreamChunk } from '../../../src/types.js';
const config = (): Config => ({...structuredClone(DEFAULT_CONFIG),schemaVersion:2, defaultProvider:'local',defaultModelId:'current',providers:{local:{type:'custom',protocol:'openai_legacy',baseUrl:'http://localhost:1234/v1'}},models:{current:{provider:'local',model:'current',label:'Current',capabilities:['tools']},vision:{provider:'local',model:'vision',label:'Vision',capabilities:['tools','image_in']}}});
const input=()=>({messages:[{role:'user' as const,content:[{type:'text' as const,text:'work'}]}],tools:[],systemPrompt:'test',invocationId:'test',deadline:Date.now()+10000,options:{signal:new AbortController().signal}});
const collect=async(stream:AsyncIterable<StreamChunk>)=>{const out=[];for await(const c of stream)out.push(c);return out};
function setup(selected:string|null='vision', fail?: (model:string)=>AsyncIterable<StreamChunk>){let cfg=config();const calls:string[]=[]; const factory=(binding:any):ModelAdapter=>({getModelName:()=>binding.wireModel,stream:()=>{calls.push(binding.modelId);return fail?fail(binding.modelId):(async function*(){yield {type:'text',delta:binding.modelId} as const;yield {type:'done'} as const;})()}});return {calls,setConfig:(v:Config)=>{cfg=v},getConfig:()=>cfg,create:()=>createProjectAgentModel({modelId:selected,loadConfig:async()=>cfg,createAdapter:factory})};}
describe('project agent model selection and request fallback',()=>{
 it('uses explicit selection and declared vision capability',async()=>{const s=setup();const model=await s.create();expect(model.binding.modelId).toBe('vision');expect(model.binding.capabilities).toContain('image_in');await collect(model.stream(input()));expect(s.calls).toEqual(['vision']);});
 it('follows current model and resolves deleted selections to current',async()=>{for(const id of [null,'deleted'])expect((await setup(id).create()).binding.modelId).toBe('current')});
 it('reloads default after failure and drops incomplete tool calls',async()=>{const s=setup('vision',async function*(name){if(name==='vision'){yield {type:'tool_use',id:'discard',name:'write',input:{}};s.setConfig({...s.getConfig(),defaultModelId:'new',models:{...s.getConfig().models,new:{provider:'local',model:'new',label:'New'}}});throw new Error('HTTP 503')}yield {type:'text',delta:'ok'};yield {type:'done'}});const model=await s.create();expect(await collect(model.stream(input()))).toEqual([{type:'text',delta:'ok'},{type:'done'}]);expect(s.calls).toEqual(['vision','new']);await collect(model.stream(input()));expect(s.calls).toEqual(['vision','new','new']);});
 it.each(['AbortError','KIMI_K3_HISTORY_INVALID','provider_conversation_authorization_invalid'])('does not fallback on cancellation or authorization: %s',async(kind)=>{const s=setup('vision',async function*(){const err=new Error(kind);if(kind==='AbortError')err.name=kind;throw err;});await expect(collect((await s.create()).stream(input()))).rejects.toThrow(kind);expect(s.calls).toEqual(['vision']);});
 it('does not loop when fallback fails or selection equals current',async()=>{for(const id of ['vision','current']){const s=setup(id,async function*(){throw new Error('HTTP 503')});await expect(collect((await s.create()).stream(input()))).rejects.toThrow('503');expect(s.calls).toEqual(id==='vision'?['vision','current']:['current'])}});
 it('requires user source, existing model, and xiaok runtime for mutation',()=>{const cfg=config();expect(()=>validateProjectAgentModelSelection('vision','xiaok',cfg,'user')).not.toThrow();expect(()=>validateProjectAgentModelSelection('vision','xiaok',cfg,'agent')).toThrow();expect(()=>validateProjectAgentModelSelection('missing','xiaok',cfg,'user')).toThrow();expect(()=>validateProjectAgentModelSelection('vision','kimi',cfg,'user')).toThrow();});
 it('does not leak private reasoning across fallback and keeps completed tool results', async () => {
  const cfg = config(); let received: unknown;
  const model = await createProjectAgentModel({modelId:'vision',loadConfig:async()=>cfg,createAdapter:binding=>({getModelName:()=>binding.wireModel,async *stream(messages){if(binding.modelId==='vision')throw new Error('404');received=messages;yield {type:'text',delta:'done'};yield {type:'done'};}})});
  const req=input();req.messages.push({role:'assistant',content:[{type:'thinking',thinking:'private'},{type:'tool_use',id:'once',name:'write',input:{}}]} as any,{role:'user',content:[{type:'tool_result',tool_use_id:'once',content:'file created'}]} as any);
  await collect(model.stream(req));expect(JSON.stringify(received)).not.toContain('private');expect(JSON.stringify(received)).toContain('file created');
 });
 it('rejects unsupported image input instead of silently pretending to see it',async()=>{
  const s=setup('current');const req=input();req.messages[0].content.push({type:'image',source:{type:'base64',media_type:'image/png',data:'AA=='}} as any);
  await expect(collect((await s.create()).stream(req))).rejects.toThrow('image_not_supported');expect(s.calls).toEqual([]);
 });
 it('rechecks workspace authority before fallback and does not send after revocation',async()=>{
  const s=setup('vision',async function*(){throw new Error('404')});let checks=0;
  await expect(collect((await s.create()).stream({...input(),beforeRequest:async()=>{if(++checks>1)throw new Error('workspace_revoked')}}))).rejects.toThrow('workspace_revoked');expect(s.calls).toEqual(['vision']);
 });
 it('falls back when adapter construction fails',async()=>{
  const model=await createProjectAgentModel({modelId:'vision',loadConfig:async()=>config(),createAdapter:binding=>{if(binding.modelId==='vision')throw new Error('unsupported model');return {getModelName:()=>binding.wireModel,async *stream(){yield {type:'text',delta:'current'};yield {type:'done'}}}}});expect(model.binding.modelId).toBe('current');
 });

});

describe('selected model permanent provider boundary',()=>{
 it.each(['invalid-tool','finished-idle','reasoning-admission','wrapped-permanent','cyclic-permanent'])('keeps %s on the original request',async kind=>{
  const invalid=createKimiTerminalBoundaryError({boundaryKind:'invalid_tool_call',sawOfficialReasoning:true,toolCallCount:1});
  let error:Error=kind==='finished-idle'?Object.assign(new Error('openai_stream_idle_timeout'),{name:'TimeoutError',code:'OPENAI_STREAM_IDLE_TIMEOUT',retryable:false}):kind==='reasoning-admission'?new Error('KIMI_REASONING_ADMISSION_REQUIRED'):invalid;
  if(kind==='wrapped-permanent'||kind==='cyclic-permanent')error=Object.assign(new Error('network timeout',{cause:invalid}),{retryable:true});
  if(kind==='cyclic-permanent')(invalid as Error&{cause:unknown}).cause=error;
  const onRecovery=vi.fn(),s=setup('vision',async function*(name){if(name==='vision')throw error;yield {type:'text',delta:'must not fallback'};yield {type:'done'};});
  const model=await s.create();await expect(collect(model.stream({...input(),onRecovery}))).rejects.toBe(error);expect(s.calls).toEqual(['vision']);expect(onRecovery).not.toHaveBeenCalled();
 });
 it('does not construct a fallback for a permanent construction error',async()=>{
  const error=Object.assign(new Error('network timeout'),{retryable:false}),calls:string[]=[];
  await expect(createProjectAgentModel({modelId:'vision',loadConfig:async()=>config(),createAdapter:binding=>{calls.push(binding.modelId);throw error;}})).rejects.toBe(error);expect(calls).toEqual(['vision']);
 });
 it('keeps an admitted missing-finish error recoverable by the existing selected fallback',async()=>{
  const error=createKimiTerminalBoundaryError({boundaryKind:'missing_finish',sawOfficialReasoning:true,toolCallCount:0}),s=setup('vision',async function*(name){if(name==='vision')throw error;yield {type:'text',delta:'recovered'};yield {type:'done'};});
  expect(await collect((await s.create()).stream(input()))).toContainEqual({type:'text',delta:'recovered'});expect(s.calls).toEqual(['vision','current']);
 });
 it('terminates a cyclic transient cause and preserves ordinary fallback',async()=>{
  const error=Object.assign(new Error('HTTP 503'),{cause:null as unknown});error.cause=error;const s=setup('vision',async function*(name){if(name==='vision')throw error;yield {type:'text',delta:'fallback'};yield {type:'done'};});await collect((await s.create()).stream(input()));expect(s.calls).toEqual(['vision','current']);
 });
 it('actual OpenAIAdapter invalid tool stream cannot activate the default model',async()=>{
  const cfg=config();cfg.providers.kimi={type:'first_party',protocol:'openai_legacy',apiKey:'fictional',baseUrl:'https://api.kimi.com/coding/v1'};cfg.models.selectedKimi={provider:'kimi',model:'k3',label:'Fictional Kimi',capabilities:['tools','thinking']};const factories:string[]=[],onRecovery=vi.fn();let wireCalls=0;
  const model=await createProjectAgentModel({modelId:'selectedKimi',loadConfig:async()=>cfg,createAdapter:binding=>{
   factories.push(binding.modelId);if(binding.modelId!=='selectedKimi')return {getModelName:()=>binding.wireModel,async *stream(){yield {type:'text',delta:'must not run'};yield {type:'done'};}};
   const adapter=new OpenAIAdapter(buildOpenAIAdapterInit(binding));(adapter as unknown as {client:unknown}).client={chat:{completions:{create:async()=>{wireCalls++;return {async *[Symbol.asyncIterator](){yield {choices:[{delta:{reasoning_content:'',tool_calls:[{index:0,id:'fictional-call',function:{name:'write',arguments:'{"broken":'}}]},finish_reason:'tool_calls'}]};}};}}}};return adapter;
  }});
  await expect(collect(model.stream({...input(),onRecovery}))).rejects.toMatchObject({code:'KIMI_REASONING_TERMINAL_BOUNDARY_REQUIRED',boundaryKind:'invalid_tool_call',retryable:false});expect(factories).toEqual(['selectedKimi']);expect(wireCalls).toBe(1);expect(onRecovery).not.toHaveBeenCalled();
 });
});
