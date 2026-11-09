import {DEFAULT_DISPATCH_OUTPUT} from '../../shared/default-dispatch-ipc-contract.js';
import * as contracts from '../../shared/default-dispatch-ipc-contract.js';
// Contract adapter only; Native provenance is exercised by the original controller/Electron suites.
import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('electron',()=>({app:{isReady(){throw Error('contract must not call Native');}},BrowserWindow:{getAllWindows(){throw Error('contract must not call Native');},fromId(){},fromWebContents(){}},webContents:{fromId(){}}}));
import {registerDefaultDispatchIpc} from '../../electron/default-dispatch-typed-ipc.js';
import {IPC_SCHEMA_REGISTRY,resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
import type {IpcHandlerListener} from '../../electron/shutdown-aware-ipc-main.js';
const receipt=()=>({ok:true as const,operation:{parentId:'default-dispatch-parent:'+'a'.repeat(64),projectId:'p',planRevision:2,dispatchGeneration:1,children:[{childKey:'default-dispatch-child:'+'b'.repeat(64),taskId:'p__a',payloadHash:'c'.repeat(64),state:'intent_pending' as const}]}});
beforeEach(()=>resetIpcSchemaRegistryForTests());
function fixture(work:()=>Promise<unknown>=async()=>receipt(),finalHook=()=>{},preparationOwner?:unknown){
 let handler!:IpcHandlerListener,live=true,opens=0,releases=0,failures:unknown[]=[];const event={},calls:unknown[][]=[];
 const controller={openCurrentPlan(...args:unknown[]){opens++;calls.push(args);return{run:work,assertCurrent(){finalHook();if(!live)throw Error('original_frame_withdrawn');},fail(error:unknown){failures.push(error);},release(){releases++;}};}};
 registerDefaultDispatchIpc({handle(_channel,fn){handler=fn;}},controller as never,preparationOwner as never);
 return{event,calls,get opens(){return opens;},get releases(){return releases;},failures,withdraw(){live=false;},invoke:(...args:unknown[])=>handler(event as never,...args)};
}
it('registers one project-only semantic contract and carries the actual event with fixed user source',async()=>{
 const f=fixture(),result=await f.invoke({projectId:'p'});expect([...IPC_SCHEMA_REGISTRY.keys()]).toEqual(['desktop:kswarm:default-dispatch:capture']);expect(f.calls).toEqual([[f.event,'p','user']]);expect(result).toEqual(receipt());expect(Object.getPrototypeOf(result)).toBe(null);expect(f.releases).toBe(1);
});
it('keeps Main observation data separate from the original B capture receipt schema',()=>{
 const base=receipt(),observation={childKey:base.operation.children[0]!.childKey,taskId:'p__a',status:'present'},value={...base,preparationObservations:[observation]};
 expect(DEFAULT_DISPATCH_OUTPUT.parse(value)).toEqual(value);expect(()=>(contracts as any).DEFAULT_DISPATCH_CAPTURE_OUTPUT.parse(value)).toThrow();
 for(const changed of [{...value,preparationObservations:[]},{...value,preparationObservations:[{...observation,taskId:'other'}]},{...value,preparationObservations:[{...observation,childKey:'default-dispatch-child:'+'e'.repeat(64)}]},{...value,preparationObservations:[{...observation,fact:{}}]},{...value,preparationObservationUnavailable:true}])expect(()=>DEFAULT_DISPATCH_OUTPUT.parse(changed)).toThrow();
});
it('preserves a confirmed B receipt when the optional observation owner is unavailable without inspecting a fake owner',async()=>{
 let getters=0;const fake=new Proxy({},{get(){getters++;throw Error('fake owner getter');},getOwnPropertyDescriptor(){getters++;throw Error('fake owner descriptor');}}),f=fixture(async()=>receipt(),()=>{},fake);
 expect(await f.invoke({projectId:'p'})).toEqual({...receipt(),preparationObservationUnavailable:true});expect(getters).toBe(0);expect(f.failures).toEqual([]);expect(f.releases).toBe(1);
});
it('does not accept observation data supplied by the B capture reply as a Main Host observation',async()=>{
 const base=receipt(),f=fixture(async()=>({...base,preparationObservations:[{childKey:base.operation.children[0]!.childKey,taskId:'p__a',status:'present'}]}));await expect(f.invoke({projectId:'p'})).rejects.toThrow();expect(f.releases).toBe(1);
});
it('refuses extra actor, source, batch, plan and proof input before opening a user invocation',async()=>{
 const f=fixture();for(const extra of [{actor:'user'},{requestSource:'user'},{scope:{}},{batchId:'x'},{planRevision:1},{proof:{}}])await expect(f.invoke({projectId:'p',...extra})).rejects.toThrow();for(const args of [[],[{}],[{projectId:' p'}],[{projectId:'p\0'}],[{projectId:'p'},{}]])await expect(f.invoke(...args)).rejects.toThrow();expect(f.opens).toBe(0);
});
it('keeps the completed business reply subject to its original final delivery lifetime',async()=>{
 let release!:(data:unknown)=>void;const f=fixture(()=>new Promise(yes=>{release=yes;})),result=f.invoke({projectId:'p'});f.withdraw();release(receipt());await expect(result).rejects.toThrow('original_frame_withdrawn');expect(f.releases).toBe(1);
});
it('rejects unsafe output without getters and preserves the original semantic failure',async()=>{
 let hooks=0;const f=fixture(async()=>Object.defineProperty(receipt(),'extra',{enumerable:true,get(){hooks++;throw Error('forbidden output getter');}}));await expect(f.invoke({projectId:'p'})).rejects.toThrow();expect(hooks).toBe(0);expect(f.releases).toBe(1);
 const original=Error('original B durable error'),g=fixture(async()=>{throw original;});await expect(g.invoke({projectId:'p'})).rejects.toBe(original);expect(g.failures).toContain(original);expect(g.releases).toBe(1);
});
it('gives each cached original reply a fresh private projection and retains definite notInvoked failures',async()=>{
 const cached=Object.freeze(receipt()),f=fixture(async()=>cached),a=await f.invoke({projectId:'p'}),b=await f.invoke({projectId:'p'});expect(a).not.toBe(b);expect(a).toEqual(b);expect(f.releases).toBe(2);
 const g=fixture(async()=>({ok:false,error:'activity_business_closed',notInvoked:true}));expect(await g.invoke({projectId:'p'})).toEqual({ok:false,error:'activity_business_closed',notInvoked:true});
});

it('keeps the complete receipt immutable across the final admission SDK after validation',async()=>{
 let captured:any,count=0;const parse=DEFAULT_DISPATCH_OUTPUT.parse;DEFAULT_DISPATCH_OUTPUT.parse=function(...args:Parameters<typeof parse>){count++;captured=args[0];return Reflect.apply(parse,this,args);};
 const f=fixture(async()=>receipt(),()=>{try{captured.operation.children[0].state='executed';}catch{}});
 try{const result:any=await f.invoke({projectId:'p'});expect(count).toBeGreaterThanOrEqual(2);expect(result.operation.children[0].state).toBe('intent_pending');expect(Object.isFrozen(result.operation.children[0])).toBe(true);expect(Object.isFrozen(result.operation.children)).toBe(true);}finally{DEFAULT_DISPATCH_OUTPUT.parse=parse;}
});

it('does not let a late mutable collection helper bypass input descriptor capture',async()=>{
 const f=fixture();let reads=0,error:unknown;const input=Object.defineProperty({},'projectId',{enumerable:true,get(){reads++;return 'p';}}),includes=Array.prototype.includes;
 try{Array.prototype.includes=function(){return true;};try{await f.invoke(input);}catch(e){error=e;}}finally{Array.prototype.includes=includes;}
 expect(reads).toBe(0);expect(error).toBeTruthy();expect(f.opens).toBe(0);
});
