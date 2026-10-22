import { expect, vi, type TestContext } from 'vitest';
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, relative, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import * as artifactModule from '../../electron/artifact-workspace-store.js';
import * as goalModule from '../../electron/goal-store-sqlite.js';
import { getDesktopMemoryStore, type createDesktopServices } from '../../electron/desktop-services.js';
import { createDesktopServices as constructServices } from '../../electron/desktop-services.js';
import type { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';

type Services=ReturnType<typeof createDesktopServices>;
type Action=()=>unknown|Promise<unknown>;
type NativeReceipt={db:DatabaseSync;get:()=>unknown};
type StoreWithDb={db:DatabaseSync;close():void};
type Memory=ReturnType<typeof getDesktopMemoryStore>&{db?:{readonly open:boolean}};
type PartialFailureReceipt={business:Error;cleanup:Error;root:Error;validator?:unknown};

export async function withProjectModelRuntimeLifetime(ctx:TestContext,body:(owner:RuntimeFixtureLifetime)=>Promise<void>,assertFailure?:(error:unknown)=>unknown|Promise<unknown>):Promise<void>{
 let accepted:{error:unknown}|undefined;
 const scenario=(async()=>{const owner=new RuntimeFixtureLifetime();let failure:{error:unknown}|undefined;
  try{ctx.signal.throwIfAborted();owner.observe();await body(owner);}catch(error){failure={error};}
  await owner.finish(failure);
 })();
 const settledOutcome=scenario.then(()=>({failed:false,error:undefined}),(error:unknown)=>({failed:true,error}));
 ctx.onTestFinished(async()=>{
  const outcome=await settledOutcome;
  if(ctx.signal.aborted&&outcome.failed&&outcome.error!==ctx.signal.reason&&(!accepted||outcome.error!==accepted.error))throw outcome.error;
 });
 try{await scenario;}catch(error){
  if(!assertFailure)throw error;
  try{await assertFailure(error);}catch(verificationError){throw new AggregateError([error,verificationError],'project_runtime_expected_failure_verification_failed',{cause:error});}
  accepted={error};
 }
 if(assertFailure&&!accepted)throw Error('project_runtime_fixture_expected_rejection_missing');
}

class RuntimeFixtureLifetime{
 private actions:Action[]=[];
 private native=new Map<DatabaseSync,NativeReceipt>();
 private artifacts:StoreWithDb[]=[];
 private goals:StoreWithDb[]=[];
 private spies:Array<{mockRestore():void}>=[];
 private services?:Services;
 private memory?:Memory;
 private root?:string;
 private identity?:{root:string;workerPid:number;workerPpid:number;uid:number|null;runToken:string|null;stat:{dev:number;ino:number;uid:number;birthtimeMs:number}};
 private disposed=false;
 private cleanupErrors:unknown[]=[];
 private physicalFailure?:Error;
 private retainedRootFailure?:Error;

 observe():void{
  const owner=this,exec=DatabaseSync.prototype.exec;
  this.spies.push(vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,...args:Parameters<typeof exec>){
   owner.capture(this);return Reflect.apply(exec,this,args);
  }));
  const Artifact=artifactModule.ArtifactWorkspaceStore,Goal=goalModule.SqliteGoalStore;
  this.spies.push(vi.spyOn(artifactModule,'ArtifactWorkspaceStore').mockImplementation(function(...args:ConstructorParameters<typeof Artifact>){
   const instance=Reflect.construct(Artifact,args) as artifactModule.ArtifactWorkspaceStore;owner.artifacts.push(instance as unknown as StoreWithDb);return instance;
  }));
  this.spies.push(vi.spyOn(goalModule,'SqliteGoalStore').mockImplementation(function(...args:ConstructorParameters<typeof Goal>){
   const instance=Reflect.construct(Goal,args) as goalModule.SqliteGoalStore;owner.goals.push(instance as unknown as StoreWithDb);return instance;
  }));
 }
 private capture(db:DatabaseSync):void{
  if(this.native.has(db))return;
  const descriptor=Object.getOwnPropertyDescriptor(db,'isOpen'),getter=descriptor?.get;
  this.native.set(db,{db,get:()=>{
   if(typeof getter!=='function'||descriptor?.configurable!==false)throw Error('project_runtime_native_receipt_unavailable');
   const value:unknown=Reflect.apply(getter,db,[]);if(typeof value!=='boolean')throw Error('project_runtime_native_receipt_invalid');return value;
  }});
 }
 add(action:Action):void{this.actions.push(action);}
 ownRoot(root:string):void{
  this.root=root;this.add(()=>this.removeRoot());
  const canonical=realpathSync(root),stat=lstatSync(canonical);
  this.identity={root:canonical,workerPid:process.pid,workerPpid:process.ppid,uid:process.getuid?.()??null,
   runToken:process.env.XIAOK_ACTIVITY_FORENSICS_RUN_TOKEN??null,stat:{dev:stat.dev,ino:stat.ino,uid:stat.uid,birthtimeMs:stat.birthtimeMs}};
 }
 ownServer(server:Server):void{this.add(()=>new Promise<void>((resolve,reject)=>{
  if(!server.listening){resolve();return;}server.close(error=>error?reject(error):resolve());
 }));}
 ownServices(services:Services):void{
  this.services=services;
  this.add(()=>this.closeServices());
  // Default runners are constructed synchronously by createDesktopServices and
  // register notebook tools using this exact dataRoot before it returns.
  this.memory=getDesktopMemoryStore(services.getDataRoot()) as Memory;
 }
 private async attempt(action:Action):Promise<void>{try{await action();}catch(error){this.cleanupErrors.push(error);}}
 private async closeServices():Promise<void>{
  const services=this.services!;
  const before=this.cleanupErrors.length;
  await this.attempt(()=>services.goalShutdown.ingress.stopAccepting());
  await this.attempt(async()=>{await services.disposeMultiAgent();this.disposed=true;});
  await this.attempt(()=>services.closeTaskSourceWritersForMigration());
  await this.attempt(()=>services.closeMaterialRegistryAndArtifactFileManagerInstances());
  await this.attempt(()=>services.sealAndDrainArtifactWorkspaceServiceInstance());
  await this.attempt(async()=>{if(!await services.goalShutdown.ingress.drain(0))throw Error('project_runtime_goal_drain_unconfirmed');});
  // A failed/held drain is not permission to forcibly close durable journals.
  if(this.cleanupErrors.length!==before)return;
  this.assertPhysicalQuiescence();
  if(this.artifacts.length!==1||this.goals.length!==1)throw Error('project_runtime_store_inventory_unconfirmed');
  await this.attempt(()=>services.goalShutdown.durable.close());
  await this.attempt(()=>this.artifacts[0].close());
  await this.attempt(()=>services.getKnowledgeBaseStore().close());
  await this.attempt(async()=>{
   const memory=this.memory;if(!memory)throw Error('project_runtime_memory_owner_unconfirmed');
   await memory.close?.();
   if(memory.db)expect(memory.db.open).toBe(false);
   // The singleton intentionally still points at a closed original store.
   // Both its idempotent close and the next-dataRoot transition are real calls.
   await memory.close?.();
   if(memory.db)expect(memory.db.open).toBe(false);
   let next:Memory|undefined;const errors:unknown[]=[];
   try{
    next=getDesktopMemoryStore(join(this.root!,'next-memory-data')) as Memory;
    expect(next).not.toBe(memory);
    if(next.db)expect(next.db.open).toBe(true);
   }catch(error){errors.push(error);}
   if(next)for(const action of [()=>next!.close?.(),()=>next!.close?.(),()=>{if(next!.db)expect(next!.db.open).toBe(false);}]){
    try{await action();}catch(error){errors.push(error);}
   }
   if(errors.length)throw new AggregateError(errors,'project_runtime_next_memory_cleanup_failed');
  });
 }
 private coordinator():DesktopExecutionCoordinator{
  if(!this.services?.multiAgent)throw Error('project_runtime_owner_missing');
  return (this.services.multiAgent.service as unknown as {options:{coordinator:DesktopExecutionCoordinator}}).options.coordinator;
 }
 private assertPhysicalQuiescence():void{
  const active=this.coordinator().snapshot().active,blocked=this.services!.multiAgent!.service.runtimeStatus().blocked;
  if(!Number.isSafeInteger(active)||active!==0||typeof blocked!=='boolean'||blocked!==false){
   const error=Error('project_runtime_physical_owner_not_quiescent');this.physicalFailure=error;throw error;
  }
 }
 expectedRootFailure():Error{if(!this.retainedRootFailure)throw Error('project_runtime_expected_root_failure_missing');return this.retainedRootFailure;}
 expectedPhysicalFailure():Error{if(!this.physicalFailure)throw Error('project_runtime_expected_physical_failure_missing');return this.physicalFailure;}
 acquireOrdinaryLease(){return this.coordinator().acquireLease({policy:'ordinary'});}
 assertHeldOwnersStillOpen():void{
  expect(this.disposed).toBe(true);expect(this.coordinator().snapshot().active).toBe(1);
  expect(this.services!.multiAgent!.service.runtimeStatus().blocked).toBe(false);
  expect(this.native.get(this.goals[0].db)!.get()).toBe(true);
  expect(this.native.get(this.artifacts[0].db)!.get()).toBe(true);
  const kb=this.services!.getKnowledgeBaseStore() as unknown as {_db:DatabaseSync};
  expect(this.native.get(kb._db)!.get()).toBe(true);
  if(this.memory?.db)expect(this.memory.db.open).toBe(true);
  expect(existsSync(this.root!)).toBe(true);
 }
 private removeRoot():void{
  let failure:{error:unknown}|undefined;
  try{
   if(!this.identity||!this.services||!this.disposed||this.cleanupErrors.length){
    const error=Error('project_runtime_owner_cleanup_unconfirmed');this.retainedRootFailure=error;throw error;
   }
   this.assertPhysicalQuiescence();
   expect(this.artifacts).toHaveLength(1);expect(this.goals).toHaveLength(1);
   if(this.native.size===0)throw Error('project_runtime_native_inventory_missing');
   // Every receiver is an actual original object, read at deletion time.
   for(const receipt of this.native.values())expect(receipt.get()).toBe(false);
   if(this.memory?.db)expect(this.memory.db.open).toBe(false);
   const cwd=relative(this.identity.root,process.cwd());
   if(cwd===''||(!isAbsolute(cwd)&&cwd!=='..'&&!cwd.startsWith('..'+sep)))throw Error('project_runtime_cwd_still_owned');
  }catch(error){failure={error};}
  const retain=()=>console.info('XIAOK_PROJECT_RUNTIME_RETAINED_ROOT '+JSON.stringify(this.identity??{root:this.root,workerPid:process.pid,workerPpid:process.ppid}));
  if(failure){retain();throw failure.error;}
  try{rmSync(this.root!,{recursive:true,force:true});expect(existsSync(this.root!)).toBe(false);}catch(error){retain();throw error;}
  console.info('XIAOK_PROJECT_RUNTIME_CLOSED '+JSON.stringify({nativeReceivers:this.native.size,nativeOpen:[...this.native.values()].map(value=>value.get()),memoryOpen:this.memory?.db?.open??'no-native-backend'}));
 }
 async finish(body?:{error:unknown}):Promise<void>{
  for(const action of this.actions.splice(0).reverse())await this.attempt(action);
  for(const spy of this.spies.splice(0).reverse())await this.attempt(()=>spy.mockRestore());
  if(body&&!this.cleanupErrors.length)throw body.error;
  if(body||this.cleanupErrors.length)throw new AggregateError([...(body?[body.error]:[]),...this.cleanupErrors],'project_runtime_fixture_business_and_cleanup_failed');
 }
}

/** Test-only failure contract; no provider, store or SQL replacement. */
export async function assertRuntimeFixtureFailureRetention(ctx:TestContext,extraCleanup?:Action,capture?:(receipt:PartialFailureReceipt)=>void,additionalCleanup?:Action):Promise<void>{
 const business=Error('controlled_fixture_business'),cleanup=Error('controlled_fixture_cleanup');
 const attempted:string[]=[];let root='',ownerRef:RuntimeFixtureLifetime|undefined;
 await withProjectModelRuntimeLifetime(ctx,async owner=>{
   ownerRef=owner;root=mkdtempSync(join(tmpdir(),'project-model-runtime-'));owner.ownRoot(root);
   if(extraCleanup)owner.add(extraCleanup);
   if(additionalCleanup)owner.add(additionalCleanup);
   owner.add(()=>{attempted.push('last');});
   owner.add(()=>{attempted.push('failed');throw cleanup;});
   owner.add(()=>{attempted.push('first');});
   throw business;
  },failure=>{
   const receipt:PartialFailureReceipt={business,cleanup,root:ownerRef!.expectedRootFailure()};capture?.(receipt);
   try{
    assertExactKnownFailureTree(failure,[business,cleanup,receipt.root]);
    expect(attempted).toEqual(['first','failed','last']);expect(existsSync(root)).toBe(true);
   }catch(error){receipt.validator=error;throw error;}
  });
 // Unknown partial setup retains its exact root until the test worker exits.
}

export async function assertRuntimeFixtureUnknownCleanupRejected(ctx:TestContext,additionalCleanup?:Action):Promise<void>{
 const unknown=Error('controlled_unknown_cleanup_sentinel');let failure:{error:unknown}|undefined,known:PartialFailureReceipt|undefined;
 try{await assertRuntimeFixtureFailureRetention(ctx,()=>{console.info('XIAOK_PROJECT_RUNTIME_UNKNOWN_CLEANUP_EXECUTED');throw unknown;},receipt=>{known=receipt;},additionalCleanup);}
 catch(error){failure={error};}
 try{
  expect(failure?.error).toBeInstanceOf(AggregateError);expect(known).toBeDefined();
  const outer=failure!.error as AggregateError,inner=outer.errors[0];
  expect(outer.errors).toHaveLength(2);
  assertExactKnownFailureTree(inner,[known!.business,known!.cleanup,unknown,known!.root]);
  expect(outer.errors[1]).toBe(known!.validator);
  expect(outer.cause).toBe(inner);
  expect(known!.validator).toBeInstanceOf(Error);expect(known!.validator).not.toBeInstanceOf(AggregateError);
  expect(Object.hasOwn(known!.validator as object,'cause')).toBe(false);
  expect(Object.hasOwn(known!.validator as object,'errors')).toBe(false);
 }catch(error){
  if(failure)throw new AggregateError([failure.error,error],'project_runtime_unknown_cleanup_verification_failed',{cause:failure.error});
  throw error;
 }
}

export async function assertRuntimeFixtureHeldLeaseRetention(ctx:TestContext):Promise<void>{
 let ownerRef:RuntimeFixtureLifetime|undefined,ticket:Awaited<ReturnType<DesktopExecutionCoordinator['acquireLease']>>|undefined;
 let failure:{error:unknown}|undefined;
 try{
  await withProjectModelRuntimeLifetime(ctx,async owner=>{
   ownerRef=owner;const root=mkdtempSync(join(tmpdir(),'project-model-runtime-'));owner.ownRoot(root);
   const old=process.env.XIAOK_CONFIG_DIR;owner.add(()=>{if(old===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=old;});
   process.env.XIAOK_CONFIG_DIR=join(root,'config');
   const gateway={request:async()=>new Response('{}',{status:503}),getDesktopMutationToken:()=> 'fixture'};
   const services=constructServices({dataRoot:join(root,'data'),knowledgeDbPath:join(root,'knowledge.sqlite'),kswarmService:gateway as never});owner.ownServices(services);
   await services.multiAgent!.ready;ctx.signal.throwIfAborted();ticket=await owner.acquireOrdinaryLease();
  },error=>{
   assertExactKnownFailureTree(error,[ownerRef!.expectedPhysicalFailure(),ownerRef!.expectedRootFailure()]);
   ownerRef!.assertHeldOwnersStillOpen();
  });
 }catch(error){failure={error};}
 let releaseFailure:{error:unknown}|undefined;try{ticket?.release();}catch(error){releaseFailure={error};}
 if(failure&&releaseFailure)throw new AggregateError([failure.error,releaseFailure.error],'project_runtime_held_lease_cleanup_failed');
 if(failure)throw failure.error;if(releaseFailure)throw releaseFailure.error;
}

function assertExactKnownFailureTree(error:unknown,leaves:Error[]):void{
 expect(error).toBeInstanceOf(AggregateError);
 const errors=(error as AggregateError).errors;
 expect(errors).toHaveLength(leaves.length);
 for(let index=0;index<leaves.length;index++){
  expect(errors[index]).toBe(leaves[index]);
  expect(leaves[index]).not.toBeInstanceOf(AggregateError);
  expect(Object.hasOwn(leaves[index],'cause')).toBe(false);
  expect(Object.hasOwn(leaves[index],'errors')).toBe(false);
 }
 expect(Object.hasOwn(error as object,'cause')).toBe(false);
}
