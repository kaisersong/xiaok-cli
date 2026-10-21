import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {setFlagsFromString} from 'node:v8';
import {runInNewContext} from 'node:vm';
import {acquireControllerLifetimeLock} from '../../../src/runtime/verification/controller-lifetime-lock.js';
const f=vi.hoisted(()=>({failure:undefined as Error|undefined,events:[] as string[],listener:undefined as any,root:undefined as string|undefined,lifetime:undefined as WeakRef<{close():void}>|undefined,capacityFailure:undefined as Error|undefined,receiverReady:false,stackFailure:undefined as Error|undefined,constructionFailure:undefined as Error|undefined,invalidated:false,stack:undefined as object|undefined,stackClosed:false,diagnose:vi.fn(()=>({mode:'maintenance',items:[],nextCursor:null}))}));
vi.mock('../../../src/runtime/verification/installed-controller-lifetime.js',()=>({assertInstalledControllerLifetime:(value:{assertCurrent():void})=>value.assertCurrent(),createInstalledControllerLifetime:()=>{const lock=f.root?acquireControllerLifetimeLock(f.root):undefined;const lifetime={database:{},base:'/fixture',state:'/fixture/state',publicKey:{export:()=>Buffer.from('fixture-public-key')},manifest:{authorityId:'authority',allowedUserIds:[501]},assertCurrent(){if(f.invalidated)throw Error('lifetime-invalidated');lock?.assertCurrent();},close(){lock?.close();f.events.push('lifetime');}};f.lifetime=new WeakRef(lifetime);return lifetime;}}));
vi.mock('../../../src/runtime/verification/root-broker-client.js',()=>({createInstalledRootBrokerClient:()=>({dispose(){f.events.push('broker');}})}));
vi.mock('../../../src/runtime/verification/installed-shared-capacity.js',()=>({createInstalledSharedCapacity:()=>({capacity:{migrateLegacy(){f.events.push('migrate');if(f.failure)throw f.failure;}},close(){f.events.push('capacity');if(f.capacityFailure)throw f.capacityFailure;}}),isCapacityMappingNotReady:(error:Error)=>error.message==='shared_blob_migration_registration_missing'}));
vi.mock('../../../src/runtime/verification/installed-capacity-maintenance.js',()=>({createInstalledCapacityMaintenance:()=>({publicPort:{diagnose:f.diagnose},close(){f.events.push('maintenance');}})}));
vi.mock('../../../src/runtime/verification/installed-receiver-registration.js',()=>({assertInstalledReceiverRegistration(){},createInstalledReceiverRegistration(){f.events.push('receiver');if(!f.receiverReady)throw Error('normal-stack-reached');return {close(){f.events.push('receiver-close');}};}}));
vi.mock('../../../src/runtime/verification/controller-public-daemon.js',()=>({startPublicController:async(input:any)=>{f.events.push('listen');f.listener=input;return {close(){f.events.push('listener-close');}};}}));
vi.mock('../../../src/runtime/verification/installed-execution-stack.js',()=>({
 readInstalledFailedStackDrain:()=>undefined,
 createInstalledExecutionStack:async()=>{if(f.constructionFailure)throw f.constructionFailure;const stack={privateHost:{broker:{},execution:{privateHost:{raw:{},quiescence:{}}},qualification:{assertCurrent(){},currentFacts:()=>({engineBinding:{fixture:true}})}},close(){f.events.push('stack-close');if(f.stackFailure)throw f.stackFailure;f.stackClosed=true;}};f.stack=stack;return stack;},
}));
// This shutdown unit has no producer requests or verified failed-builder drain.
// Keep those facts explicit rather than sending the old DB stub into SQL census.
vi.mock('../../../src/runtime/verification/installed-maintenance-handoff.js',()=>({
 claimInstalledMaintenanceBatch(lifetime:object){if(lifetime!==f.lifetime?.deref())throw Error('fixture_handoff_lifetime');return undefined;},
 sealInstalledMaintenanceRequests(lifetime:object,stack:object){if(lifetime!==f.lifetime?.deref()||stack!==f.stack||!f.stackClosed)throw Error('fixture_handoff_undrained');},
}));
vi.mock('../../../src/runtime/verification/kswarm-enrollment-capability.js',()=>({createInstalledKSwarmEnrollmentCapability:()=>({})}));
vi.mock('../../../src/runtime/verification/installed-migration-publisher.js',()=>({createInstalledProfileIndexPublisher:()=>({})}));
vi.mock('../../../src/runtime/verification/completion-composition.js',()=>({createVerificationCompletionComposition(){throw Error('completion-construction-failed');}}));
import {startInstalledVerificationController} from '../../../src/runtime/verification/installed-controller.js';
beforeEach(()=>{f.events=[];f.listener=undefined;f.diagnose.mockClear();f.root=undefined;f.lifetime=undefined;f.capacityFailure=undefined;f.receiverReady=false;f.stackFailure=undefined;f.constructionFailure=undefined;f.invalidated=false;f.stack=undefined;f.stackClosed=false;});
it('starts diagnosis before any engine or receiver on known missing mapping and denies all new work',async()=>{
 f.failure=Error('shared_blob_migration_registration_missing');const controller=await startInstalledVerificationController();
 const peer={uid:501,gid:20,auditSessionId:1},payload={requestSource:'user',ownerKind:'task',ownerId:'task',cursor:null,limit:16},signal=new AbortController().signal;
 try{
  expect(f.events).toEqual(['migrate','listen']);
  await expect(f.listener.invoke('maintenance.diagnose',payload,peer,signal)).resolves.toMatchObject({mode:'maintenance'});
  expect(f.diagnose).toHaveBeenCalledOnce();
  for(const method of ['controller.qualification','materials.prepare','execution.reserve','verification.prepare','publication.prepare','completion.prepare-owner','archive.read','maintenance.retryMigration'])await expect(f.listener.invoke(method,{},peer,signal)).rejects.toThrow('installed_controller_maintenance');
  expect(f.events).toEqual(['migrate','listen']);
 }finally{await controller.close();}
 expect(f.events).toEqual(['migrate','listen','listener-close','maintenance','capacity','broker','lifetime']);
});
it.each(['shared_blob_migration_tuple','shared_capacity_pool_identity','SQLITE_CORRUPT'])('does not turn integrity failure into maintenance: %s',async reason=>{
 f.failure=Error(reason);await expect(startInstalledVerificationController()).rejects.toThrow(reason);expect(f.listener).toBeUndefined();expect(f.events).toEqual(['migrate','capacity','broker']);
});
it('continues to normal assembly after successful migration',async()=>{
 f.failure=undefined;await expect(startInstalledVerificationController()).rejects.toThrow('normal-stack-reached');expect(f.events).toEqual(['migrate','receiver','capacity','broker']);
});

const roots:string[]=[];
afterEach(()=>{if(f.root){f.lifetime?.deref()?.close();}for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
setFlagsFromString('--expose_gc');const collect=runInNewContext('gc') as ()=>void;
it('keeps the failed startup actual OS lifetime strongly reachable through GC, without a spy retaining its result',async()=>{
 f.root=mkdtempSync(join(tmpdir(),'startup-lifetime-gc-'));roots.push(f.root);f.failure=Error('SQLITE_CORRUPT');
 await expect(startInstalledVerificationController()).rejects.toThrow(f.failure);
 expect(f.events).toEqual(['migrate','capacity','broker']);
 for(let i=0;i<12;i++){await nextTurn();collect();await nextTurn();}
 expect(f.lifetime?.deref()).toBeDefined();
 let second:ReturnType<typeof acquireControllerLifetimeLock>|undefined,error:unknown;
 try{second=acquireControllerLifetimeLock(f.root);}catch(cause){error=cause;}finally{second?.close();}
 expect(error).toBeDefined();
});
it('keeps the original startup cause alongside cleanup failure and retains dependent owners',async()=>{
 const original=Error('SQLITE_CORRUPT'),cleanup=Error('capacity-close-failed');f.failure=original;f.capacityFailure=cleanup;
 let error:unknown;try{await startInstalledVerificationController();}catch(cause){error=cause;}
 expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).cause).toBe(original);
 expect((error as AggregateError).errors[0]).toBe(original);
 expect((error as AggregateError).errors[1]).toBeInstanceOf(AggregateError);
 expect(((error as AggregateError).errors[1] as AggregateError).errors).toEqual([cleanup]);
 expect(f.events).toEqual(['migrate','capacity']);
});
it('closes an already constructed stack before its dependent owners if a later assembly constructor fails',async()=>{
 f.failure=undefined;f.receiverReady=true;
 await expect(startInstalledVerificationController()).rejects.toThrow('completion-construction-failed');
 expect(f.events).toEqual(['migrate','receiver','stack-close','receiver-close','capacity','broker']);
});
it('attempts the original stack drain but keeps all dependent owners on its unknown failure',async()=>{
 f.failure=undefined;f.receiverReady=true;f.stackFailure=Error('stack-drain-unknown');
 let error:unknown;try{await startInstalledVerificationController();}catch(cause){error=cause;}
 expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).cause).toMatchObject({message:'completion-construction-failed'});
 expect(f.events).toEqual(['migrate','receiver','stack-close']);
});

it('does not close receiver, capacity or broker when stack construction has an unknown partial drain',async()=>{
 f.failure=undefined;f.receiverReady=true;const original=Error('stack-construction-cleanup-unknown');f.constructionFailure=original;
 let error:unknown;try{await startInstalledVerificationController();}catch(cause){error=cause;}
 expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).cause).toBe(original);
 expect(((error as AggregateError).errors[1] as AggregateError).errors).toMatchObject([{message:'installed_stack_construction_unknown'}]);
 expect(f.events).toEqual(['migrate','receiver']);
});
it('never replaces the actual cleanup failure with an invalidated lifetime assertion',async()=>{
 const original=Error('SQLITE_CORRUPT'),cleanup=Error('capacity-close-failed');f.failure=original;f.capacityFailure=cleanup;f.invalidated=true;
 let error:unknown;try{await startInstalledVerificationController();}catch(cause){error=cause;}
 expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).cause).toBe(original);
 expect(((error as AggregateError).errors[1] as AggregateError).errors).toEqual([cleanup]);
 expect(f.events).toEqual(['migrate','capacity']);
});
