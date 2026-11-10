// @vitest-environment node
// Original Host + same population/Store, controlled constructor Source only.
import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import * as fileIo from 'node:fs/promises';
import * as hosts from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
const {defaultDispatchBusinessIdentity}=createRequire(resolve('package.json'))(resolve('../../kswarm/src/core/default-dispatch-birth-rules.js'));
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function fixture(now:()=>unknown=()=>1){
 const root=mkdtempSync(join(tmpdir(),'dsh-host-io-')),path=join(root,'tasks'),store=new FileTaskSnapshotStore(path),population=hosts.createTaskSourceWriterPopulation(store),proof=Object.freeze({}),scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
 const data={scope,projectId:'p',taskId:'p__a',runId:'run',businessExecutionGeneration:1,childKey:defaultDispatchBusinessIdentity(scope,'p','p__a').childKey,payloadHash:'d'.repeat(64),bindingDigest:'e'.repeat(64),hostId:'host',input:{prompt:'Original Host work',materials:[],permissionMode:'plan'}};
 const source={resolve(value:object){if(value!==proof)throw Error('controlled_original_source_required');return{data,assertCurrent(){}};}};
 const host=population.createHost({defaultDispatchPreparationSource:source,materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),runner:async()=>{throw Error('runner must not execute');},now:now as ()=>number});
 let fixtureOnlyStoreCleanup=false;
 cleanups.push(async()=>{if(fixtureOnlyStoreCleanup){await store.closeAndDrain().catch(()=>{});console.log(JSON.stringify({fixture:'failed-population-close-known-store-cleanup',notProductDrain:true}));}else await population.close().catch(()=>{});rmSync(root,{recursive:true,force:true,maxRetries:5});});
 function io(){const read=(hosts as any).readOriginalTaskHostPreparationIO;expect(read).toBeTypeOf('function');return read(host,source);}
 return{root,path,store,population,proof,source,host,io,cleanupFailedClose(){fixtureOnlyStoreCleanup=true;}};
}
it('returns the same fixed Host IO only after original Host and exact constructor Source membership',()=>{
 const f=fixture(),io=f.io();expect(f.io()).toBe(io);expect(Object.isFrozen(io)).toBe(true);let reads=0;const fake=new Proxy({},{get(){reads++;throw Error('forbidden');}}),read=(hosts as any).readOriginalTaskHostPreparationIO;
 expect(()=>read(fake,f.source)).toThrow();expect(()=>read(f.host,fake)).toThrow();expect(reads).toBe(0);expect(existsSync(f.path)).toBe(false);
});
it('uses the actual original Host builder and Store IO despite later public and private method shadows',async()=>{
 const f=fixture(),io=f.io();let reads=0;
 for(const name of ['prepareDefaultDispatchTask','readDefaultDispatchPreparation','runSourceOperation','recordSourcePersistence','resolveContextHistory','defaultDispatchPreparationIssuer','defaultDispatchPreparationClock'])Object.defineProperty(f.host,name,{get(){reads++;throw Error('late Host dispatch '+name);}});
 for(const name of ['prepareDefaultDispatchSnapshot','readDefaultDispatchPreparation'])Object.defineProperty(f.store,name,{get(){reads++;throw Error('late Store dispatch');}});
 const result=await io.prepare(f.proof,'scheduler');expect(existsSync(join(f.path,'snapshots',result.fact.taskId+'.json'))).toBe(true);expect(await io.observe(f.proof,'scheduler')).toEqual(result.fact);expect(reads).toBe(0);
});
it('closes the actual fixed Source population normally after original prepare and observation',async()=>{
 const f=fixture(),io=f.io();await io.prepare(f.proof,'scheduler');await io.observe(f.proof,'scheduler');await expect(f.population.close()).resolves.toBeUndefined();
});
it('rechecks original lifetime on a previously obtained IO facade and still refuses non-scheduler proofs',async()=>{
 const f=fixture(),io=f.io();for(const source of ['user','agent'])await expect(io.prepare(f.proof,source)).rejects.toThrow();await expect(io.prepare({},'scheduler')).rejects.toThrow();f.host.stopAccepting('fixture_retired');await expect(io.prepare(f.proof,'scheduler')).rejects.toThrow();expect(existsSync(f.path)).toBe(false);
});
it('keeps both original public preparation siblings closed after stopAccepting',async()=>{
 const f=fixture();f.host.stopAccepting('fixture_retired');await expect(f.host.prepareDefaultDispatchTask(f.proof,'scheduler')).rejects.toThrow();await expect(f.host.readDefaultDispatchPreparation(f.proof,'scheduler')).rejects.toThrow();expect(existsSync(f.path)).toBe(false);
});
it('seals the actual Source Host population without invoking a later public stop method shadow',async()=>{
 const f=fixture(),io=f.io(),original=f.host.stopAccepting;let calls=0;Object.defineProperty(f.host,'stopAccepting',{configurable:true,value(){calls++;throw Error('late stop shadow');}});
 try{try{f.population.stopAccepting('fixture_population_stop');}catch{}let prepared=false;await io.prepare(f.proof,'scheduler').then(()=>{prepared=true;},()=>{});expect(prepared).toBe(false);expect(calls).toBe(0);expect(existsSync(f.path)).toBe(false);}finally{Object.defineProperty(f.host,'stopAccepting',{configurable:true,value:original});}
});
it('seals later Source siblings even when an ordinary participant stop callback throws',async()=>{
 const f=fixture(),materials=new MaterialRegistry({workspaceRoot:join(f.root,'other-workspace'),maxBytes:1024}),ordinary=f.population.createHost({materialRegistry:materials,runner:async()=>{}}),second=f.population.createHost({defaultDispatchPreparationSource:f.source,materialRegistry:materials,runner:async()=>{},now:()=>1}),io=(hosts as any).readOriginalTaskHostPreparationIO(second,f.source),original=ordinary.stopAccepting,failure=Error('ordinary stop failed');
 Object.defineProperty(ordinary,'stopAccepting',{configurable:true,value(){throw failure;}});try{let observed;try{f.population.stopAccepting('population_stop');}catch(error){observed=error;}expect(observed).toBe(failure);await expect(io.prepare(f.proof,'scheduler')).rejects.toThrow();expect(existsSync(f.path)).toBe(false);}finally{Object.defineProperty(ordinary,'stopAccepting',{configurable:true,value:original});}
});
it('treats an empty shutdown reason as a closed ingress instead of a permission to prepare',async()=>{
 const f=fixture(),io=f.io();f.host.stopAccepting('');await expect(io.prepare(f.proof,'scheduler')).rejects.toThrow();await expect(f.host.prepareDefaultDispatchTask(f.proof,'scheduler')).rejects.toThrow();expect(existsSync(f.path)).toBe(false);
});
it('seals later Source siblings and returns a rejected close promise when an ordinary seal throws',async()=>{
 const f=fixture(),materials=new MaterialRegistry({workspaceRoot:join(f.root,'other-workspace'),maxBytes:1024}),ordinary=f.population.createHost({materialRegistry:materials,runner:async()=>{}}),second=f.population.createHost({defaultDispatchPreparationSource:f.source,materialRegistry:materials,runner:async()=>{},now:()=>1}),io=(hosts as any).readOriginalTaskHostPreparationIO(second,f.source),prototype=ordinary as any,original=prototype.sealSourceIngress,failure=Error('ordinary seal failed');
 prototype.sealSourceIngress=()=>{throw failure;};let closing:Promise<void>|undefined;try{try{closing=f.population.close();void closing.catch(()=>{});}catch{f.cleanupFailedClose();}let prepared=false;await io.prepare(f.proof,'scheduler').then(()=>{prepared=true;},()=>{});expect(prepared).toBe(false);expect(closing).toBeInstanceOf(Promise);if(closing)await expect(closing).rejects.toThrow();}finally{prototype.sealSourceIngress=original;}
});
it('joins a known Source raw before reporting a synchronous ordinary drain failure',async()=>{
 let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;}),f=fixture(()=>raw),ordinary=f.population.createHost({materialRegistry:new MaterialRegistry({workspaceRoot:join(f.root,'other-workspace'),maxBytes:1024}),runner:async()=>{}}),prototype=ordinary as any,original=prototype.drainSourceParticipant;await expect(f.io().prepare(f.proof,'scheduler')).rejects.toThrow();prototype.drainSourceParticipant=()=>{throw Error('ordinary drain failed');};let settled=false;const closing=f.population.close().then(()=>{settled=true;},()=>{settled=true;});try{await delay(15);expect(settled).toBe(false);}finally{prototype.drainSourceParticipant=original;release();await closing;await delay(1);}
});
it('uses the actual Store close for a Source population even when the public close method is replaced',async()=>{
 const f=fixture(),probe=await fileIo.open(join(f.root,'probe'),'w'),prototype=Object.getPrototypeOf(probe),sync=prototype.sync;await probe.close();let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(yes=>{entered=yes;});
 prototype.sync=function(...args:unknown[]){const handle=this;entered();return new Promise<void>((yes,no)=>{release=()=>{Reflect.apply(sync,handle,args).then(yes,no);};});};
 let writing:Promise<unknown>|undefined,closing:Promise<void>|undefined;const original=f.store.closeAndDrain;try{
  writing=f.store.saveWithReceipt({taskId:'ordinary',sessionId:'ordinary-session',status:'understanding',prompt:'Known original queued writer',materials:[],events:[],createdAt:1,updatedAt:1});await ready;prototype.sync=sync;let fakeClose=0,settled=false;f.store.closeAndDrain=async()=>{fakeClose++;};closing=f.population.close().then(()=>{settled=true;},()=>{settled=true;});await delay(15);expect(settled).toBe(false);expect(fakeClose).toBe(0);
 }finally{prototype.sync=sync;f.store.closeAndDrain=original;release?.();await writing;await closing;}
});
it('retains an original clock raw across source-state shadows and population close',async()=>{
 let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;}),f=fixture(()=>raw),io=f.io();
 for(const name of ['sourceOperations','sourceInvocations','sourceClosingInvocations','sourceCloseFailures','sourceClosing','sourceTailClosed'])Object.defineProperty(f.host,name,{get(){throw Error('late source state '+name);},configurable:true});
 await expect(io.prepare(f.proof,'scheduler')).rejects.toThrow();let settled=false;const closing=f.population.close().then(()=>{settled=true;},()=>{settled=true;});try{await delay(15);expect(settled).toBe(false);}finally{release();await closing;}
});
for(const failing of ['stopAccepting','drainSourceParticipant'] as const)it(`joins a Source known raw during shutdown after an ordinary ${failing} throws`,async()=>{
 let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;}),f=fixture(()=>raw),ordinary=f.population.createHost({materialRegistry:new MaterialRegistry({workspaceRoot:join(f.root,'ordinary'),maxBytes:1024}),runner:async()=>{}}),target=ordinary as any,original=target[failing];
 await expect(f.io().prepare(f.proof,'scheduler')).rejects.toThrow();target[failing]=()=>{throw Error('ordinary shutdown failure');};let shutdown:Promise<boolean>|undefined,settled=false;
 try{try{shutdown=f.population.drainShutdown();void shutdown.then(()=>{settled=true;},()=>{settled=true;});}catch{}await delay(15);expect(shutdown).toBeInstanceOf(Promise);expect(settled).toBe(false);}
 finally{target[failing]=original;release();if(shutdown)await shutdown;}
 expect(f.population.getShutdownDrainedReceipt()).toBeUndefined();
});
it('returns one negative retirement promise after a seal failure and joins its accepted original write',async()=>{
 const f=fixture(),ordinary=f.population.createHost({materialRegistry:new MaterialRegistry({workspaceRoot:join(f.root,'ordinary'),maxBytes:1024}),runner:async()=>{}}),target=ordinary as any,originalSeal=target.sealSourceIngress,originalSave=f.store.save.bind(f.store),failure=Error('original retirement seal failure');
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(yes=>{entered=yes;}),held=new Promise<void>(yes=>{release=yes;});
 f.store.save=async(...args)=>{entered();await held;return originalSave(...args);};
 const preparing=ordinary.prepareTask({prompt:'Accepted retirement write',materials:[]});await ready;target.sealSourceIngress=()=>{throw failure;};let retiring:Promise<void>|undefined,settled=false;
 try{try{retiring=f.population.retireHost(ordinary);void retiring.then(()=>{settled=true;},()=>{settled=true;});}catch{}expect(retiring).toBeInstanceOf(Promise);expect(f.population.retireHost(ordinary)).toBe(retiring);await delay(15);expect(settled).toBe(false);}
 finally{target.sealSourceIngress=originalSeal;f.store.save=originalSave;release();await preparing;}
 if(retiring){const error=await retiring.catch(error=>error);expect(error).toBeInstanceOf(AggregateError);expect(error.cause).toBe(failure);}
 expect(f.population.retainedHostCount).toBe(2);
});
