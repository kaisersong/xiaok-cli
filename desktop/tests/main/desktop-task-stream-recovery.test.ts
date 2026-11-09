// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { streamDesktopTaskRecovery } from '../../electron/desktop-task-stream.js';
const policy = { windowMs: 100, idleMs: 30, initialDelayMs: 0, maxDelayMs: 0 };
const request = (adapter: any, extra: any = {}) => ({ adapter,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'continue' }] }], tools: [], systemPrompt: '',
  options: { signal: new AbortController().signal }, invocationId: 'first', deadline: Date.now() + 1000, policy, ...extra });
const collect = async (input: any) => { const out = []; for await (const x of streamDesktopTaskRecovery(input)) out.push(x); return out; };
describe('Desktop model request recovery', () => {
  it.each(['prepare_return','invocation_callback'] as const)('rechecks the private synchronous guard at %s before the actual provider',async frame=>{
    let allowed=true;const sentinel=Error('original_project_start_revoked'),stream=vi.fn(async function*(){yield{type:'done'};});
    const beforeEffects=()=>{if(!allowed)throw sentinel;};
    const input=request({stream},{beforeEffects,prepareRequest:async(current:any)=>{if(frame==='prepare_return')allowed=false;return current;},onInvocation:()=>{if(frame==='invocation_callback')allowed=false;}});
    let failure:unknown;try{await collect(input);}catch(error){failure=error;}
    expect(stream).not.toHaveBeenCalled();expect(failure).toBe(sentinel);
  });
  it.each(['boolean','promise'] as const)('rejects a non-void %s start guard before the actual provider',async kind=>{
    const stream=vi.fn(async function*(){yield{type:'done'};});
    let failure:unknown;try{await collect(request({stream},{beforeEffects:()=>kind==='boolean'?false:Promise.reject(Error('guard_must_be_synchronous'))}));}catch(error){failure=error;}
    expect(stream).not.toHaveBeenCalled();expect(failure).toBeInstanceOf(Error);
  });
  it('recovers before any text without child agents, refreshing request and usage identity', async () => {
    const prepare = vi.fn(async (r: any) => r), ids: string[] = [], signals: AbortSignal[] = [];
    let calls = 0;
    const adapter = { async *stream(_m: any, _t: any, _s: any, o: any) {
      signals.push(o.signal); if (++calls < 3) throw new Error('terminated');
      yield { type: 'text', delta: 'continued' }; yield { type: 'done' };
    } };
    const out = await collect(request(adapter, { prepareRequest: prepare, onInvocation: (id: string) => ids.push(id) }));
    expect(out.some(x => x.type === 'text' && x.delta === 'continued')).toBe(true); expect(calls).toBe(3);
    expect(prepare).toHaveBeenCalledTimes(3); expect(new Set(ids).size).toBe(3);
    expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(true);
    expect(signals[2].aborted).toBe(true);
  });
  it('never retries preparation or consumer persistence failures', async () => {
    const adapter = { stream: vi.fn(async function*() { yield { type: 'text', delta: 'prefix' }; }) };
    await expect(collect(request(adapter, { prepareRequest: async () => { throw new Error('terminated journal'); } }))).rejects.toThrow('journal');
    expect(adapter.stream).not.toHaveBeenCalled();
    await expect((async () => { for await (const _x of streamDesktopTaskRecovery(request(adapter))) throw new Error('terminated consumer'); })()).rejects.toThrow('consumer');
    expect(adapter.stream).toHaveBeenCalledOnce();
  });
  it('never retries a failed recovery status write or revoked authorization', async () => {
    let calls = 0; const adapter = { async *stream() { calls++; throw new Error('terminated'); } };
    await expect(collect(request(adapter, { onRecovery: async () => { throw new Error('terminated status journal'); } }))).rejects.toThrow('status journal');
    expect(calls).toBe(1);
    const beforeRequest = vi.fn(async () => { throw new Error('terminated authorization'); });
    await expect(collect(request(adapter, { beforeRequest }))).rejects.toThrow('authorization'); expect(calls).toBe(1);
  });
  it('drops incomplete tool calls from retry messages and preserves the committed history', async () => {
    const seen: any[] = []; let calls = 0; const reset = vi.fn();
    const adapter = { async *stream(m: any) { seen.push(structuredClone(m)); if (++calls === 1) {
      yield { type: 'text', delta: 'visible partial' }; yield { type: 'tool_use', id: 'unexecuted', name: 'write', input: {} }; throw new Error('terminated'); }
      yield { type: 'text', delta: ' continuation' }; yield { type: 'done' };
    } };
    await collect(request(adapter, { onRecovery: reset }));
    expect(reset).toHaveBeenCalledOnce(); expect(seen[1][0]).toEqual(seen[0][0]);
    expect(JSON.stringify(seen[1])).toContain('visible partial'); expect(JSON.stringify(seen[1])).not.toContain('unexecuted');
  });
  it.each([401, 403])('does not retry permanent %s errors wrapped in terminated', async status => {
    let calls = 0; const e = Object.assign(new Error('terminated'), { cause: { status } });
    await expect(collect(request({ async *stream() { calls++; throw e; } }))).rejects.toBe(e); expect(calls).toBe(1);
  });
  it('aborts a stuck provider at the absolute deadline', async () => {
    const signals: AbortSignal[] = []; let calls = 0;
    await expect(collect(request({ async *stream(_m: any, _t: any, _s: any, o: any) { calls++; signals.push(o.signal); await new Promise(() => {}); } },
      { deadline: Date.now() + 20, policy: { ...policy, idleMs: 1000 } }))).rejects.toThrow('desktop_tool_loop_deadline_exceeded');
    expect(calls).toBe(1); expect(signals[0].aborted).toBe(true);
  });
  it('cancels recovery backoff immediately with the caller reason', async () => {
    const ctl = new AbortController(), reason = new DOMException('user stop', 'AbortError'); let calls = 0;
    await expect(collect(request({ async *stream() { calls++; throw new Error('terminated'); } }, {
      options: { signal: ctl.signal }, onRecovery: () => ctl.abort(reason), policy: { ...policy, initialDelayMs: 1000 },
    }))).rejects.toBe(reason); expect(calls).toBe(1);
  });
});

it('recovers idle model reads and ignores abandoned output', async () => {
  let calls = 0; const signals: AbortSignal[] = [];
  const out = await collect(request({ async *stream(_m: any, _t: any, _s: any, o: any) {
    signals.push(o.signal); if (++calls === 1) await new Promise(() => {});
    yield { type: 'text', delta: 'healthy' }; yield { type: 'done' };
  } }));
  expect(calls).toBe(2); expect(signals[0].aborted).toBe(true); expect(out.some(x => x.type === 'text' && x.delta === 'healthy')).toBe(true);
});
it('keeps tools disabled when recovering an eligible child summary', async () => {
  const tools: any[] = []; let calls = 0;
  await collect(request({ async *stream(_m: any, t: any) {
    tools.push(t); if (++calls === 1) { yield { type: 'text', delta: 'prefix' }; throw new Error('terminated'); }
    yield { type: 'text', delta: 'tail' }; yield { type: 'done' };
  } }, { tools: [{ name: 'write', inputSchema: {} }], canRecover: () => true }));
  expect(tools[0]).toHaveLength(1); expect(tools[1]).toEqual([]);
});
it('does not accept an empty or tool-emitting summary-only recovery', async () => {
  for (const mode of ['empty', 'tool']) {
    await expect(collect(request({ async *stream() {
      if (mode === 'tool') yield { type: 'tool_use', id: 'bad', name: 'write', input: {} };
      yield { type: 'done' };
    } }, { summaryOnly: true }))).rejects.toThrow(/summary_recovery/);
  }
});

function usageDeferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
it('persists every genuine usage chunk once before yielding it, including multiple chunks per invocation', async () => {
  const writes: Array<[number, string]> = [];
  const adapter = { async *stream() { yield {type:'usage',usage:{inputTokens:2,outputTokens:3}}; yield {type:'usage',usage:{inputTokens:5,outputTokens:7}}; yield {type:'text',delta:'done'}; yield {type:'done'}; } };
  const out = await collect(request(adapter, { onUsage: async (chunk: any,id: string) => { writes.push([chunk.usage.inputTokens,id]); } }));
  expect(writes).toEqual([[2,'first'],[5,'first']]);expect(out.filter(chunk=>chunk.type==='usage')).toHaveLength(2);
});
it.each(['usage','text','tool_use'] as const)('owns the original late %s read after outward cancellation and waits for durable usage', async type => {
  const {createDesktopModelPhysicalScope,admitDesktopModelPhysicalRead,closeDesktopModelPhysicalScope}=await import('../../electron/desktop-task-stream.js');
  const entered=usageDeferred(),release=usageDeferred(),sinkEntered=usageDeferred(),sinkRelease=usageDeferred();
  const controller=new AbortController(),reason=Error('original cancellation'),scope=createDesktopModelPhysicalScope(),run=admitDesktopModelPhysicalRead(scope);
  let writes=0,closed=false,calls=0;
  const adapter={async *stream(){calls++;entered.resolve();await release.promise;yield type==='usage'?{type,usage:{inputTokens:17,outputTokens:19}}:type==='text'?{type,delta:'forbidden late text'}:{type,id:'late',name:'write',input:{}};}};
  const observed=(async()=>{try{for await(const _chunk of streamDesktopTaskRecovery(request(adapter,{options:{signal:controller.signal},policy:{...policy,idleMs:10000},onUsage:async()=>{writes++;sinkEntered.resolve();await sinkRelease.promise;}}),run))throw Error('late visible chunk forbidden');}finally{run.finish();}})();
  try{
    await entered.promise;controller.abort(reason);await expect(observed).rejects.toBe(reason);
    const closing=closeDesktopModelPhysicalScope(scope,reason);void closing.then(()=>{closed=true;},()=>{closed=true;});
    release.resolve();
    if(type==='usage'){await sinkEntered.promise;await new Promise<void>(resolve=>setImmediate(resolve));expect(closed).toBe(false);sinkRelease.resolve();}
    await closing;expect(writes).toBe(type==='usage'?1:0);expect(calls).toBe(1);
  }finally{release.resolve();sinkRelease.resolve();await Promise.allSettled([observed,closeDesktopModelPhysicalScope(scope,reason)]);}
});
it('never retries a physical usage sink failure named network timeout and retains its original error in drain', async()=>{
  const {createDesktopModelPhysicalScope,admitDesktopModelPhysicalRead,closeDesktopModelPhysicalScope}=await import('../../electron/desktop-task-stream.js');
  const scope=createDesktopModelPhysicalScope(),run=admitDesktopModelPhysicalRead(scope),failure=Error('network timeout while persisting original usage');let calls=0;
  const adapter={async *stream(){calls++;yield {type:'usage',usage:{inputTokens:1,outputTokens:2}};yield {type:'text',delta:'done'};yield {type:'done'};}};
  const observed=(async()=>{try{for await(const _chunk of streamDesktopTaskRecovery(request(adapter,{onUsage:()=>{throw failure;}}),run)){} }finally{run.finish();}})();
  await expect(observed).rejects.toBe(failure);expect(calls).toBe(1);
  await expect(closeDesktopModelPhysicalScope(scope)).rejects.toMatchObject({errors:[failure]});
});
it('retains the original invocation for late usage after an idle retry starts', async()=>{
  const {createDesktopModelPhysicalScope,admitDesktopModelPhysicalRead,closeDesktopModelPhysicalScope}=await import('../../electron/desktop-task-stream.js');
  const scope=createDesktopModelPhysicalScope(),run=admitDesktopModelPhysicalRead(scope),release=usageDeferred(),secondEntered=usageDeferred();
  const invocations:string[]=[],writes:Array<[number,string]>=[];let calls=0;
  const adapter={async *stream(){if(++calls===1){await release.promise;yield {type:'usage',usage:{inputTokens:1,outputTokens:2}};}else{secondEntered.resolve();yield {type:'usage',usage:{inputTokens:3,outputTokens:4}};yield {type:'done'};}}};
  const observed=(async()=>{try{for await(const _chunk of streamDesktopTaskRecovery(request(adapter,{onInvocation:(id:string)=>invocations.push(id),onUsage:async(chunk:any,id:string)=>{writes.push([chunk.usage.inputTokens,id]);}}),run)){} }finally{run.finish();}})();
  try{await secondEntered.promise;release.resolve();await observed;await closeDesktopModelPhysicalScope(scope);expect(invocations).toHaveLength(2);expect(invocations[0]).toBe('first');expect(invocations[1]).not.toBe('first');expect(writes).toContainEqual([1,invocations[0]]);expect(writes).toContainEqual([3,invocations[1]]);expect(writes).toHaveLength(2);}
  finally{release.resolve();await Promise.allSettled([observed,closeDesktopModelPhysicalScope(scope)]);}
});
it('retains the original deferred sink failure after outward cancellation', async()=>{
  const {createDesktopModelPhysicalScope,admitDesktopModelPhysicalRead,closeDesktopModelPhysicalScope}=await import('../../electron/desktop-task-stream.js');
  const scope=createDesktopModelPhysicalScope(),run=admitDesktopModelPhysicalRead(scope),entered=usageDeferred(),release=usageDeferred(),sinkEntered=usageDeferred(),sinkRelease=usageDeferred();
  const ctl=new AbortController(),reason=Error('cancel'),failure=Error('network timeout in late usage sink');let calls=0,sinkCalls=0;
  const adapter={async *stream(){calls++;entered.resolve();await release.promise;yield {type:'usage',usage:{inputTokens:1,outputTokens:2}};}};
  const observed=(async()=>{try{for await(const _chunk of streamDesktopTaskRecovery(request(adapter,{options:{signal:ctl.signal},onUsage:async()=>{sinkCalls++;sinkEntered.resolve();await sinkRelease.promise;throw failure;}}),run)){} }finally{run.finish();}})();
  try{await entered.promise;ctl.abort(reason);await expect(observed).rejects.toBe(reason);release.resolve();await sinkEntered.promise;sinkRelease.resolve();const drainError=await closeDesktopModelPhysicalScope(scope,reason).catch(error=>error);expect(drainError).toBeInstanceOf(AggregateError);expect(drainError.errors.length).toBeGreaterThan(0);for(const error of drainError.errors)expect(error).toBe(failure);expect(calls).toBe(1);expect(sinkCalls).toBe(1);}
  finally{release.resolve();sinkRelease.resolve();await Promise.allSettled([observed,closeDesktopModelPhysicalScope(scope,reason)]);}
});
