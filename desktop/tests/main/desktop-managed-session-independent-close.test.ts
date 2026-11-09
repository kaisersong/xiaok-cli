// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {DesktopManagedAgentSession} from '../../electron/desktop-managed-agent-session.js';

const control=vi.hoisted(()=>({close:undefined as undefined|(()=>Promise<void>)}));
vi.mock('../../electron/desktop-task-stream.js',async original=>{
 const actual=await original<typeof import('../../electron/desktop-task-stream.js')>();
 return {...actual,closeDesktopModelPhysicalScope:(...args:Parameters<typeof actual.closeDesktopModelPhysicalScope>)=>control.close?control.close():actual.closeDesktopModelPhysicalScope(...args)};
});
afterEach(()=>{control.close=undefined;});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return {promise,resolve};}
const tick=()=>new Promise<void>(yes=>setImmediate(yes));
function fixture(execution:()=>Promise<void>,drain:()=>Promise<void>){
 const release=vi.fn(async()=>{}),owner=vi.fn(),initial=vi.fn(),registry=vi.fn();
 // These are negative-only observation ports. They grant no original owner,
 // model request, Native role or physical-known receipt; run() is never called.
 const session=new DesktopManagedAgentSession({adapter:{async *stream(){throw Error('unexpected_provider');}},systemPrompt:'',parentMessages:[],forkContext:false,
  getTurnContext:()=>{throw Error('unexpected_context');},createRegistry:()=>{throw Error('unexpected_registry');},dataRoot:'',materials:[],skillCatalog:{} as never,emitRuntimeEvent:()=>{},releaseResources:release});
 Object.assign(session,{scope:{dispose:registry},observed:{child:{execution:{dispose:execution},owner:{dispose:owner}},host:{drainTransport:drain},initialScope:{dispose:initial}}});
 return {session,release,owner,initial,registry};
}
it('attempts both independent negative ports after physical rejection and preserves all raw failures including undefined',async()=>{
 const executeError={original:'execution'},transportError={original:'transport'};
 const execution=vi.fn(async()=>{throw executeError;}),drain=vi.fn(async()=>{throw transportError;});
 control.close=()=>Promise.reject(undefined);const f=fixture(execution,drain);
 const raw=f.session.dispose();expect(f.session.dispose()).toBe(raw);
 const outcome=await raw.then(()=>({ok:true as const}),error=>({ok:false as const,error}));
 expect(execution).toHaveBeenCalledOnce();expect(drain).toHaveBeenCalledOnce();expect(outcome.ok).toBe(false);
 if(outcome.ok)throw Error('expected_original_negative_failure');
 expect(outcome.error).toBeInstanceOf(AggregateError);expect(outcome.error.errors).toEqual([undefined,executeError,transportError]);
 expect(Object.hasOwn(outcome.error,'cause')).toBe(true);expect(outcome.error.cause).toBeUndefined();
 for(const release of [f.release,f.owner,f.initial,f.registry])expect(release).not.toHaveBeenCalled();
 await expect(f.session.run('must remain closed')).rejects.toThrow(/closed/);
});
it('enters both independent negative ports before waiting on a held physical close without releasing resources',async()=>{
 const held=deferred(),execution=vi.fn(async()=>{}),drain=vi.fn(async()=>{});control.close=()=>held.promise;
 const f=fixture(execution,drain),raw=f.session.dispose();let settled=false;void raw.then(()=>{settled=true;},()=>{settled=true;});
 try{await tick();expect(execution).toHaveBeenCalledOnce();expect(drain).toHaveBeenCalledOnce();expect(settled).toBe(false);
  for(const release of [f.release,f.owner,f.initial,f.registry])expect(release).not.toHaveBeenCalled();
 }finally{held.resolve();await raw;}
 expect(f.release).toHaveBeenCalledOnce();expect(f.owner).toHaveBeenCalledOnce();expect(f.initial).toHaveBeenCalledOnce();expect(f.registry).toHaveBeenCalledOnce();
});
it('a synchronous undefined deactivation failure still attempts physical and independent negative stops',async()=>{
 const execution=vi.fn(async()=>{}),drain=vi.fn(async()=>{});let closeCalls=0;
 control.close=()=>{if(++closeCalls===1)throw undefined;return Promise.resolve();};const f=fixture(execution,drain);
 const outcome=await f.session.dispose().then(()=>({ok:true as const}),error=>({ok:false as const,error}));
 expect(closeCalls).toBe(2);expect(execution).toHaveBeenCalledOnce();expect(drain).toHaveBeenCalledOnce();
 expect(outcome).toEqual({ok:false,error:undefined});for(const release of [f.release,f.owner,f.initial,f.registry])expect(release).not.toHaveBeenCalled();
});
