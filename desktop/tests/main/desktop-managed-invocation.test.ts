// @vitest-environment node
// Session lifecycle unit checks only. Context metadata here grants no production
// authority and creates no Task, effect receipt or canonical source.
import {expect,it,vi} from 'vitest';
import {DesktopManagedAgentSession} from '../../electron/desktop-managed-agent-session.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}
function setup(openInvocation:any){
 let turn=1;const lifetime=new AbortController(),releaseResources=vi.fn(async()=>{}),parentStream=vi.fn(async function*(){throw new Error('parent_sampling_forbidden');yield {type:'done' as const};});
 const scopedDisposals:ReturnType<typeof vi.fn>[]= [];const session=new DesktopManagedAgentSession({adapter:{stream:parentStream},systemPrompt:'child fixture',forkContext:false,materials:[],skillCatalog:{list:()=>[]} as never,dataRoot:'/tmp/invocation-contract-unused',getTurnContext:()=>({sourceTaskId:'root_task_fixture',groupId:'group',agentId:'child',cwd:'/tmp',turn,turnId:'turn-'+turn,signal:lifetime.signal,effectiveDeadline:Date.now()+30000}) as never,createRegistry:()=>{const registry=new ToolRegistry({autoMode:true},[]);const dispose=vi.fn(()=>registry.dispose());scopedDisposals.push(dispose);return {registry,dispose};},emitRuntimeEvent:async()=>{},releaseResources,openInvocation} as any);
 return {session,parentStream,releaseResources,scopedDisposals,next:()=>turn++};
}
it('a failed invocation drain stays failed after running clears and prevents later resource release',async()=>{
 const close=vi.fn(async()=>{throw new Error('original_close_unknown');}),f=setup(async()=>({adapter:{async *stream(){yield {type:'text',delta:'answer'};yield {type:'done'};},getModelName:()=> 'separate'},closeAndDrain:close}));
 await expect(f.session.run('run')).rejects.toThrow('original_close_unknown');await Promise.resolve();await expect(f.session.dispose()).rejects.toThrow('original_close_unknown');expect(close).toHaveBeenCalledOnce();expect(f.releaseResources).not.toHaveBeenCalled();expect(f.parentStream).not.toHaveBeenCalled();
});
it('dispose waits for the original acquired invocation close before releasing session resources',async()=>{
 const closeGate=gate(),close=vi.fn(()=>closeGate.promise),f=setup(async()=>({adapter:{async *stream(){yield {type:'text',delta:'answer'};yield {type:'done'};},getModelName:()=> 'separate'},closeAndDrain:close}));let disposal:Promise<void>|undefined;const running=f.session.run('run');
 try{await vi.waitFor(()=>expect(close).toHaveBeenCalledOnce());disposal=f.session.dispose();await Promise.resolve();expect(f.releaseResources).not.toHaveBeenCalled();}finally{closeGate.release();await running.catch(()=>{});await disposal;}
 expect(f.releaseResources).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
});
it('deactivation during an actual factory await drains the late lease without any sampling',async()=>{
 const factoryGate=gate(),entered=gate(),close=vi.fn(async()=>{}),stream=vi.fn(async function*(){yield {type:'text' as const,delta:'late forbidden'};}),f=setup(async()=>{entered.release();await factoryGate.promise;return {adapter:{stream,getModelName:()=> 'late'},closeAndDrain:close};});const running=f.session.run('run');const rejected=expect(running).rejects.toThrow();
 try{await Promise.race([entered.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('factory not entered')),1000))]);await f.session.deactivate();}finally{factoryGate.release();await rejected;await f.session.dispose();}
 expect(stream).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();expect(f.releaseResources).toHaveBeenCalledOnce();
});
it('each followup gets an independent engine and original close while retaining completed conversation text',async()=>{
 const engines:any[]=[],histories:unknown[]=[],open=vi.fn(async()=>{const index=engines.length,lease={adapter:{async *stream(messages:any){histories.push(structuredClone(messages));yield {type:'text',delta:'child answer '+index};yield {type:'done'};},getModelName:()=> 'independent'},closeAndDrain:vi.fn(async()=>{})};engines.push(lease);return lease;}),f=setup(open);
 try{expect(await f.session.run('first')).toBe('child answer 0');f.next();expect(await f.session.run('second')).toBe('child answer 1');expect(open).toHaveBeenCalledTimes(2);expect(engines[0].adapter).not.toBe(engines[1].adapter);expect(JSON.stringify(histories[1])).toContain('child answer 0');for(const lease of engines)expect(lease.closeAndDrain).toHaveBeenCalledOnce();expect(f.parentStream).not.toHaveBeenCalled();}finally{await f.session.dispose();}
});

it.each([new Error('drain_failed'),undefined,null,false])('an unknown invocation failure permanently blocks another run and suspend (%s)',async fault=>{
 const open=vi.fn(async()=>({adapter:{async *stream(){yield {type:'text',delta:'answer'};yield {type:'done'};},getModelName:()=> 'separate'},closeAndDrain:async()=>{throw fault;}})),f=setup(open);
 await expect(f.session.run('first')).rejects.toBe(fault);await Promise.resolve();f.next();await expect(f.session.run('must not reopen')).rejects.toBe(fault);expect(open).toHaveBeenCalledOnce();await expect(f.session.suspend()).rejects.toBe(fault);await expect(f.session.dispose()).rejects.toBe(fault);expect(f.releaseResources).not.toHaveBeenCalled();
});
it('a child activity callback failure disposes its already acquired original scope before the run settles',async()=>{
 const open=vi.fn(),f=setup(open);try{await expect(f.session.run('first',undefined,{onActivity:()=>{throw new Error('activity_failed');}} as never)).rejects.toThrow('activity_failed');expect(f.scopedDisposals).toHaveLength(1);expect(f.scopedDisposals[0]).toHaveBeenCalledOnce();expect(open).not.toHaveBeenCalled();}finally{await f.session.dispose();}
});

it('a completed child reply cannot escape after its original actor is deactivated during invocation drain',async()=>{
 const closeGate=gate(),close=vi.fn(()=>closeGate.promise),f=setup(async()=>({adapter:{async *stream(){yield {type:'text',delta:'late answer'};yield {type:'done'};},getModelName:()=> 'separate'},closeAndDrain:close}));const running=f.session.run('run');const rejected=expect(running).rejects.toThrow();
 try{await vi.waitFor(()=>expect(close).toHaveBeenCalledOnce());await f.session.deactivate();}finally{closeGate.release();await rejected;await f.session.dispose();}
 expect(f.releaseResources).toHaveBeenCalledOnce();
});

it('a child activity callback that deactivates the session prevents even invocation resource creation',async()=>{
 const open=vi.fn(async()=>({adapter:{getModelName:()=> 'unused',async *stream(){}},closeAndDrain:async()=>{}})),f=setup(open);try{await expect(f.session.run('first',undefined,{onActivity:()=>{void f.session.deactivate();}} as never)).rejects.toThrow();expect(open).not.toHaveBeenCalled();}finally{await f.session.dispose();}
});
