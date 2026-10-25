import { afterEach, describe, expect, it, vi } from 'vitest';
import fsPromises from 'node:fs/promises';
import childProcess from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withObservationMetrics, measureToolResult, measureProviderStream } from '../../../src/runtime/trace/observation-metrics.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { bashTool } from '../../../src/ai/tools/bash.js';
import type { ToolExecutionContext, StreamChunk } from '../../../src/types.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 3 }))); });
async function root() { const path = await mkdtemp(join(tmpdir(), 'xiaok-metrics-')); roots.push(path); return path; }
async function reports(dir: string) { return Promise.all((await readdir(dir)).filter(n => n.endsWith('.json')).map(async n => JSON.parse(await readFile(join(dir,n),'utf8')))); }
const context = (id: string) => ({ toolInvocationId: id, signal: new AbortController().signal } as ToolExecutionContext);

describe('P0b observation metrics', () => {
  it('defaults off and does not change return value or failure identity', async () => {
    vi.stubEnv('XIAOK_METRICS_DIR', '');
    const marker = new Error('PRIVATE ERROR');
    const originalPromise=Promise.resolve(42);
    expect(withObservationMetrics('cli',()=>originalPromise)).toBe(originalPromise);
    await expect(withObservationMetrics('cli', async () => { measureToolResult('history_result','secret','read','PRIVATE'); return 42; })).resolves.toBe(42);
    await expect(withObservationMetrics('cli', async () => { throw marker; })).rejects.toBe(marker);
    let calls = 0;
    await expect(withObservationMetrics('cli', () => { calls++; throw marker; })).rejects.toBe(marker);
    expect(calls).toBe(1);
  });
  it('disables unsupported UID platforms before touching the filesystem', async () => {
    vi.stubGlobal('process',{...process,getuid:undefined});
    const read=vi.spyOn(fsPromises,'lstat');
    expect(await withObservationMetrics('cli',async()=>42,{directory:'C:\\metrics'})).toBe(42);
    expect(read).not.toHaveBeenCalled();
  });
  it('distinguishes UTF8 bytes from UTF16 units and only publishes completed JSON files', async () => {
    const dir=await root();
    await withObservationMetrics('cli',async()=>{
      measureToolResult('history_result','id','read','你😀');
      expect(await readdir(dir)).toEqual([]);
    },{directory:dir});
    const names=await readdir(dir);
    expect(names).toHaveLength(1); expect(names[0]).toMatch(/^metrics-.*\.json$/);
    const [r]=await reports(dir); expect(r.events[0]).toMatchObject({bytes:7,units:3});
  });
  it('records bounded metadata without values, IDs, commands or private reasoning', async () => {
    const dir = await root(); const secret = 'PRIVATE-SECRET';
    await withObservationMetrics('cli', async () => {
      measureToolResult('history_result',secret,secret,secret);
      const stream = measureProviderStream({ messages: [{ role:'assistant', content:[{type:'thinking',thinking:secret}] }, {role:'user',content:[{type:'tool_result',tool_use_id:secret,content:secret}]}], surface:'cli-chat-task' }, () => (async function*(){
        yield {type:'usage',usage:{inputTokens:7,outputTokens:2,cacheReadInputTokens:3}} as StreamChunk;
        yield {type:'usage',usage:{inputTokens:7,outputTokens:2}} as StreamChunk;
      })());
      for await (const _ of stream) { /* actual measurement wrapper */ }
    }, { directory:dir });
    const [r] = await reports(dir);
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(r.events.filter((e:any)=>e.kind==='provider_usage')).toHaveLength(2);
    expect(r.events.find((e:any)=>e.kind==='provider_usage').cacheWriteTokens).toBeNull();
    expect(r.events.find((e:any)=>e.kind==='adapter_request').toolResultBytes).toBe(Buffer.byteLength(secret));
    expect(r.admission).toBe('inconclusive'); expect(r.complete).toBe(true);
  });
  it('isolates nested and parallel owners and marks dropped events incomplete', async () => {
    const dir = await root();
    await Promise.all(['cli','desktop'].map(surface => withObservationMetrics(surface as 'cli'|'desktop', async () => {
      measureToolResult('history_result','same','read','a');
      await withObservationMetrics('desktop-child', async () => { measureToolResult('history_result','same','read','bb'); }, {directory:dir});
      measureToolResult('history_result','same','read','ccc');
    }, {directory:dir,maxEvents:1})));
    const rs = await reports(dir); expect(rs).toHaveLength(4);
    const parents=rs.filter(r=>r.surface!=='desktop-child');
    expect(parents.every(r=>r.events.length===1 && r.droppedEvents===1 && !r.complete)).toBe(true);
    expect(rs.filter(r=>r.surface==='desktop-child').every(r=>parents.some(p=>p.runId===r.parentRunId))).toBe(true);
  });
  it('does not count strict owner authorization refusals as adapter requests', async () => {
    const { OpenAIAdapter }=await import('../../../src/ai/adapters/openai.js');
    const { buildOpenAIHarnessContext,resolveKimiHarnessFeatureFlags }=await import('../../../src/ai/providers/model-harness-profile.js');
    const { streamCliCompactionProviderConversation }=await import('../../../src/ai/runtime/provider-conversation-authorization.js');
    const adapter=new OpenAIAdapter({apiKey:'test',kimiCodingHeadersApplied:true,harnessContext:buildOpenAIHarnessContext({identity:{providerId:'kimi',providerType:'first_party',protocol:'openai_legacy',canonicalBaseUrl:'https://api.kimi.com/coding/v1',wireModel:'k3',capabilities:['tools','thinking']},flags:resolveKimiHarnessFeatureFlags({})})});
    const stream=vi.spyOn(adapter,'stream');const dir=await root();
    await withObservationMetrics('cli',async()=>{
      expect(()=>streamCliCompactionProviderConversation({adapter,messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'id',content:'not permitted'}]}],tools:[],systemPrompt:'fixture',invocationId:'fixture'})).toThrow();
    },{directory:dir});
    expect(stream).not.toHaveBeenCalled();
    expect((await reports(dir))[0].events).toEqual([]);
  });
  it('preserves synchronous adapter errors and closes streams on consumer return', async () => {
    const dir = await root(); const marker=new Error('PRIVATE'); let closed=false;
    await withObservationMetrics('cli', async () => {
      expect(()=>measureProviderStream({messages:[],surface:'cli-chat-task'},()=>{throw marker;})).toThrow(marker);
      const stream=measureProviderStream({messages:[],surface:'cli-chat-task'},()=>(async function*(){try { yield {type:'text',delta:'hi'} as StreamChunk; }finally{closed=true;}})());
      for await(const _ of stream)break;
    },{directory:dir});
    expect(closed).toBe(true);
    expect((await reports(dir))[0].events.filter((e:any)=>e.kind==='provider_end').map((e:any)=>e.status)).toEqual(['rejected','closed']);
  });
  it('forwards recovery cancellation to return even while next is pending', async () => {
    const { recoverModelStream }=await import('../../../src/ai/runtime/model-stream-recovery.js');
    const dir=await root();let closed=false;const abort=new AbortController();const marker=new DOMException('stop','AbortError');
    await withObservationMetrics('cli',async()=>{
      const consuming=(async()=>{for await(const _ of recoverModelStream({signal:abort.signal,policy:{windowMs:0,idleMs:0,initialDelayMs:1,maxDelayMs:1},open:()=>measureProviderStream({messages:[],surface:'cli-chat-task'},()=>({[Symbol.asyncIterator](){return {next:()=>new Promise<IteratorResult<StreamChunk>>(()=>{}),return:async()=>{closed=true;return {done:true,value:undefined};}};}}))})){ /* pending read */ }})();
      queueMicrotask(()=>abort.abort(marker));
      await expect(consuming).rejects.toBe(marker);
      expect(closed).toBe(true);
    },{directory:dir});
  });
  it('does not wait indefinitely for an unconsumed stream or accept late events', async () => {
    const dir=await root();let stream:AsyncIterable<StreamChunk>;const started=performance.now();
    await withObservationMetrics('cli',async()=>{stream=measureProviderStream({messages:[],surface:'cli-chat-task'},()=>(async function*(){yield {type:'usage',usage:{inputTokens:1,outputTokens:1}} as StreamChunk;})());},{directory:dir});
    expect(performance.now()-started).toBeLessThan(1000);
    const [before]=await reports(dir);expect(before.complete).toBe(false);expect(before.openStreams).toBe(1);
    for await(const _ of stream!){ /* owner is already sealed */ }
    expect((await reports(dir))[0]).toEqual(before);
  });
  it('does not replace business results when output directory is invalid', async () => {
    const dir=await root(); const absent=join(dir,'not-created');
    expect(await withObservationMetrics('cli',async()=>42,{directory:absent})).toBe(42);
    expect(await readdir(dir)).toEqual([]);
  });
  it('rejects shared writable directories without changing business results', async () => {
    if(process.platform==='win32')return;
    const dir=await root(); await chmod(dir,0o777);
    await withObservationMetrics('cli',async()=>{measureToolResult('history_result','id','read','x');return 42;},{directory:dir});
    expect(await readdir(dir)).toEqual([]);
  });
  it('rejects a private leaf inside a replaceable ancestor', async () => {
    if(process.platform==='win32')return;
    const dir=await root(); const leaf=join(dir,'private');await mkdir(leaf,{mode:0o700});await chmod(dir,0o777);
    expect(await withObservationMetrics('cli',async()=>42,{directory:leaf})).toBe(42);
    expect(await readdir(leaf)).toEqual([]);
  });
  it('rejects macOS ACL grants even when POSIX mode is private', async () => {
    const dir=await root();
    vi.stubGlobal('process',{...process,platform:'darwin'});
    vi.spyOn(childProcess,'execFile').mockImplementation(((...args: any[]) => {
      args.at(-1)(null,'drwx------ 2 owner staff private\n'.repeat(args[1].length-3)+' 0: user:other allow read,write,file_inherit,directory_inherit\n','');
      return {};
    }) as any);
    expect(await withObservationMetrics('cli',async()=>42,{directory:dir})).toBe(42);
    expect(await readdir(dir)).toEqual([]);
  });
  it('rejects a real inheritable macOS ACL on a disposable private directory', async () => {
    if(process.platform!=='darwin')return;
    const dir=await root();const leaf=join(dir,'acl');await mkdir(leaf,{mode:0o700});
    try{
      childProcess.execFileSync('/bin/chmod',['+a','everyone allow read,write,execute,file_inherit,directory_inherit',leaf]);
      expect((await fsPromises.stat(leaf)).mode&0o077).toBe(0);
      expect(await withObservationMetrics('cli',async()=>42,{directory:leaf})).toBe(42);
      expect(await readdir(leaf)).toEqual([]);
    }finally{childProcess.execFileSync('/bin/chmod',['-N',leaf]);}
  });
  it('starts business work immediately even if metric directory validation stalls', async () => {
    const dir=await root();vi.spyOn(fsPromises,'lstat').mockReturnValue(new Promise(()=>{}));
    const deadline=performance.now()+100;
    expect(await withObservationMetrics('cli',async()=>performance.now()<deadline,{directory:dir})).toBe(true);
  });
  it('measures pre-hook context at the actual model cap input', async () => {
    const dir=await root();const registry=new ToolRegistry({autoMode:true,hooksRunner:{runPreHooks:async()=>({ok:true,additionalContext:'x'.repeat(300000)}),runPostHooks:async()=>[],runHooks:async()=>({ok:true})} as never},[{permission:'safe',definition:{name:'read',description:'fixture',inputSchema:{type:'object',properties:{}}},execute:async()=>'a'}]);
    await withObservationMetrics('cli',async()=>{await registry.executeTool('read',{},context('hook'));},{directory:dir});
    const [r]=await reports(dir);expect(r.events.find((e:any)=>e.kind==='registry_visible').bytes).toBe(300002);
    expect(r.events.find((e:any)=>e.kind==='registry_return').bytes).toBeLessThan(300002);
  });
  it('bounds stalled directory validation and publication', async () => {
    const dir=await root();
    const stalled=new Promise<never>(()=>{});
    const validation=vi.spyOn(fsPromises,'lstat').mockReturnValue(stalled);
    const started=performance.now();
    expect(await withObservationMetrics('cli',async()=>42,{directory:dir})).toBe(42);
    expect(performance.now()-started).toBeLessThan(1500);
    validation.mockRestore();
    vi.spyOn(fsPromises,'open').mockReturnValue(stalled);
    const marker=new Error('business'); const publishStarted=performance.now();
    await expect(withObservationMetrics('cli',async()=>{throw marker;},{directory:dir})).rejects.toBe(marker);
    expect(performance.now()-publishStarted).toBeLessThan(1500);
  });
  it.each(['write','link'] as const)('keeps the business error and cleans temporary files on %s failure', async operation => {
    const dir=await root();const marker=new Error('business marker');
    if(operation==='link')vi.spyOn(fsPromises,'link').mockRejectedValue(new Error('disk failure'));
    else {
      const originalOpen=fsPromises.open;
      vi.spyOn(fsPromises,'open').mockImplementation(async(...args:Parameters<typeof fsPromises.open>)=>{
        const file=await originalOpen(...args);vi.spyOn(file,'writeFile').mockRejectedValue(new Error('disk failure'));return file;
      });
    }
    await expect(withObservationMetrics('cli',async()=>{throw marker;},{directory:dir})).rejects.toBe(marker);
    expect(await readdir(dir)).toEqual([]);
  });
  it('separates actual recovery attempts after an asynchronous stream failure', async () => {
    const { recoverModelStream }=await import('../../../src/ai/runtime/model-stream-recovery.js');
    const dir=await root();let attempts=0;
    await withObservationMetrics('cli',async()=>{
      for await(const _ of recoverModelStream({signal:new AbortController().signal,policy:{windowMs:1000,idleMs:100,initialDelayMs:1,maxDelayMs:1},
        open:()=>measureProviderStream({messages:[],surface:'cli-chat-task'},()=>(async function*(){
          yield {type:'usage',usage:{inputTokens:1,outputTokens:1}} as StreamChunk;
          if(++attempts===1)throw new Error('ECONNRESET');
          yield {type:'text',delta:'done'} as StreamChunk;
        })())})){ /* real retry owner */ }
    },{directory:dir});
    const [r]=await reports(dir);expect(r.complete).toBe(true);
    expect(r.events.filter((e:any)=>e.kind==='adapter_request').map((e:any)=>e.requestId)).toEqual([1,2]);
    expect(r.events.filter((e:any)=>e.kind==='provider_end').map((e:any)=>[e.requestId,e.status])).toEqual([[1,'rejected'],[2,'completed']]);
    expect(r.events.filter((e:any)=>e.kind==='provider_usage').map((e:any)=>e.requestId)).toEqual([1,2]);
  });
  it('uses the real bash collector and registry before/after caps', async () => {
    if(process.platform==='win32')return;
    const dir=await root(); const registry=new ToolRegistry({autoMode:true}); registry.registerTool(bashTool);
    await withObservationMetrics('cli',async()=>{
      const result=await registry.executeTool('bash',{command:"printf '%15000s' x",max_chars:100},context('bash-private'));
      expect(result.length).toBeLessThan(1000);
      registry.registerTool({permission:'safe',definition:{name:'large',description:'large',inputSchema:{type:'object',properties:{}}},execute:async()=> 'x'.repeat(300000)});
      await registry.executeTool('large',{},context('large-private'));
    },{directory:dir});
    const [r]=await reports(dir);
    expect(r.events.find((e:any)=>e.kind==='collector').bytes).toBe(15000);
    const visible=r.events.filter((e:any)=>e.kind==='registry_visible');
    const returned=r.events.filter((e:any)=>e.kind==='registry_return');
    expect(visible.at(-1).bytes).toBe(300000); expect(returned.at(-1).bytes).toBeLessThan(300000);
  });
  it('measures early registry rejections as returned results', async () => {
    const dir=await root(); const registry=new ToolRegistry({autoMode:false,onPrompt:async()=>false},[]);
    registry.registerTool({permission:'write',definition:{name:'write',description:'fixture',inputSchema:{type:'object',properties:{}}},execute:async()=>{throw new Error('must not run');}});
    const results:string[]=[];
    await withObservationMetrics('cli',async()=>{
      results.push(await registry.executeTool('unknown',{},context('one')));
      results.push(await registry.executeTool('write',{},context('two')));
    },{directory:dir});
    const [r]=await reports(dir);
    expect(r.events.filter((e:any)=>e.kind==='registry_return').map((e:any)=>e.bytes)).toEqual(results.map(s=>Buffer.byteLength(s)));
    expect(r.events.filter((e:any)=>e.kind==='registry_visible')).toHaveLength(0);
  });
});

describe('real CLI runtime metrics wiring', () => {
  it.each(['cli-chat-task','cli-subagent'] as const)('measures cancellation history without changing the abort: %s', async providerSurfaceKind => {
    const { AgentRuntime } = await import('../../../src/ai/runtime/agent-runtime.js');
    const { AgentSessionState } = await import('../../../src/ai/runtime/session.js');
    const { AgentRunController } = await import('../../../src/ai/runtime/controller.js');
    const dir=await root();vi.stubEnv('XIAOK_METRICS_DIR',dir);
    const external=new AbortController();const reason=new DOMException('cancel','AbortError');
    const session=new AgentSessionState();
    const registry=new ToolRegistry({autoMode:true},[{permission:'safe',definition:{name:'read',description:'fixture',inputSchema:{type:'object',properties:{}}},execute:async()=>{external.abort(reason);throw reason;}}]);
    const runtime=new AgentRuntime({registry,session,controller:new AgentRunController(),systemPrompt:'fixture',providerSurfaceKind,
      adapter:{getModelName:()=> 'fixture',async *stream(){yield {type:'tool_use',id:'cancelled-call',name:'read',input:{}};yield {type:'done'};}}});
    await expect(runtime.run('fixture',()=>{},external.signal)).rejects.toBe(reason);
    const [r]=await reports(dir);expect(r.outcome).toBe('rejected');
    expect(r.events.filter((e:any)=>e.kind==='history_result')).toMatchObject([{bytes:Buffer.byteLength('[user-cancelled]'),family:'read'}]);
    expect(r.events.filter((e:any)=>e.kind==='registry_return')).toEqual([]);
  });
  it.each(['cli-chat-task','cli-subagent'] as const)('collects actual run, registry, history and provider boundaries: %s', async providerSurfaceKind => {
    const { AgentRuntime } = await import('../../../src/ai/runtime/agent-runtime.js');
    const { AgentSessionState } = await import('../../../src/ai/runtime/session.js');
    const { AgentRunController } = await import('../../../src/ai/runtime/controller.js');
    const dir=await root(); vi.stubEnv('XIAOK_METRICS_DIR',dir); let calls=0;
    const registry=new ToolRegistry({autoMode:true},[{permission:'safe',definition:{name:'read',description:'read',inputSchema:{type:'object',properties:{}}},execute:async()=>'你😀'}]);
    const runtime=new AgentRuntime({registry,session:new AgentSessionState(),controller:new AgentRunController(),systemPrompt:'PRIVATE',providerSurfaceKind,
      adapter:{getModelName:()=> 'fixture',async *stream(){
        if(++calls===1)yield {type:'tool_use',id:'PRIVATE-CALL',name:'read',input:{}};
        else yield {type:'text',delta:'finished'};
        yield {type:'usage',usage:{inputTokens:8,outputTokens:2,cacheReadInputTokens:4}};
        yield {type:'done'};
      }}});
    await runtime.run('PRIVATE USER',()=>{});
    const [r]=await reports(dir);
    expect(r.surface).toBe(providerSurfaceKind==='cli-subagent'?'cli-child':'cli');
    expect(r.complete).toBe(true);expect(r.openStreams).toBe(0);
    expect(r.events.filter((e:any)=>e.kind==='adapter_request')).toHaveLength(2);
    expect(r.events.find((e:any)=>e.kind==='history_result').bytes).toBe(7);
    expect(r.events.filter((e:any)=>e.kind==='adapter_request').at(-1).toolResultBytes).toBe(7);
    expect(JSON.stringify(r)).not.toContain('PRIVATE');
  });
});
