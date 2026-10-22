import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InProcessTaskRuntimeHost} from '../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../src/runtime/task-host/snapshot-store.js';
import {captureQualifiedSourceCallbacks,armQualifiedSourceFailure,bindQualifiedSourceFailureSpy,beginQualifiedSourceFailurePublication,consumeQualifiedSourceFailure,finishQualifiedSourceCallbacks,restoreQualifiedSourceFailureSpy,restoreQualifiedSourceCallbacks,type QualifiedSourceFailureOccurrence} from '../../desktop/tests/fixtures/qualified-group-callback-closure.js';

function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

for(const fault of ['none','undefined','null','duplicate-F','forged-consumption'] as const){
 it(`proves original source callbacks separately from native health: ${fault}`,async()=>{
  // These constructors do no IO. Inject authorization and persistence leaves;
  // publication, mutation/source bookkeeping and Store close methods are real.
  const root=join(tmpdir(),`xiaok-source-proof-${randomUUID()}`),store=new FileTaskSnapshotStore(root);
  const closure={version:1 as const,requiresReauthorization:true as const,observations:[]};
  const snapshot={taskId:'canonical',status:'completed',protectedObservationClosure:closure};
  store.observations.read=async()=>closure;
  store.recoverTask=async()=>snapshot as never;
  const ticket={};
  const host=new InProcessTaskRuntimeHost({snapshotStore:store,groupObservationSource:{inspectGroupObservationReference:(actual:unknown)=>{expect(actual).toBe(ticket);return {taskId:'canonical',canonicalTaskId:'canonical',closure};},commitGroupObservationReference:()=>{throw Error('a rejected write cannot commit');}}} as never);
  let closing=false,binding:ReturnType<typeof captureQualifiedSourceCallbacks>|undefined,save:{mockRestore():void}|undefined;
  let bodyFailure:{error:unknown}|undefined,writerRelease:(()=>void)|undefined,sourceObservation:Promise<void>|undefined;
  try{
   binding=captureQualifiedSourceCallbacks(host,store,{retain:<T,>(_label:string,value:T)=>value,isClosing:()=>closing});
   const F=Error('original source persistence failure');armQualifiedSourceFailure(binding,{taskId:'canonical',ticket,expected:F});
   save=vi.spyOn(FileTaskSnapshotStore.prototype,'save').mockImplementation(function(this:FileTaskSnapshotStore,...args){expect(this).toBe(store);expect(args).toHaveLength(2);return Promise.reject(F);});
   bindQualifiedSourceFailureSpy(binding,FileTaskSnapshotStore.prototype.save);
   const publication=beginQualifiedSourceFailurePublication(binding,ticket);await expect(publication).rejects.toBe(F);expect(save).toHaveBeenCalledTimes(1);
   const originalOccurrence=await consumeQualifiedSourceFailure(binding,publication,F);
   const occurrence=fault==='forged-consumption'?Object.freeze({...originalOccurrence}) as QualifiedSourceFailureOccurrence:originalOccurrence;
   restoreQualifiedSourceFailureSpy(binding);save.mockRestore();
   const internal=host as unknown as {sourceCloseFailures:unknown[];sourceDrainPromise:Promise<unknown[]>};
   const extras:unknown[]=fault==='undefined'?[undefined]:fault==='null'?[null]:fault==='duplicate-F'?[F]:[];
   for(const extra of extras){const additional=host['recordSourcePersistence'](()=>Promise.reject(extra));await expect(additional).rejects.toBe(extra);}
   const writer=gate();writerRelease=writer.resolve;(store as unknown as {writerQueue:Promise<void>}).writerQueue=writer.promise;closing=true;
   const sourceSlot={receiver:host,method:host.closeSourceWriterForMigration,args:[],rawWritten:true,raw:host.closeSourceWriterForMigration(),outcome:undefined as {ok:false;error:unknown}|undefined};
   let settled=false;const observed=sourceSlot.raw.then(()=>{settled=true;throw Error('source failure must remain rejected');},error=>{settled=true;sourceSlot.outcome={ok:false,error};});sourceObservation=observed;
   await tick();expect(settled).toBe(false);writer.resolve();await observed;
   expect(sourceSlot.raw).toBe(host.closeSourceWriterForMigration());expect(sourceSlot.outcome?.error).toBeInstanceOf(AggregateError);
   const originalErrors=(sourceSlot.outcome!.error as AggregateError).errors as unknown[];
   const drain=await internal.sourceDrainPromise,expected=[F,...extras];
   for(const population of [originalErrors,drain,internal.sourceCloseFailures]){expect(population).toHaveLength(expected.length);for(let i=0;i<expected.length;i++){expect(Object.hasOwn(population,i)).toBe(true);expect(population[i]).toBe(expected[i]);}}
   if(fault==='none'){
    const receipt=await finishQualifiedSourceCallbacks(binding,occurrence,sourceSlot);
    expect(receipt).toMatchObject({callbacksTerminal:true,nativeHealthy:false});expect(receipt.originalSourceClose).toBe(sourceSlot.raw);expect(receipt.originalSourceError).toBe(sourceSlot.outcome!.error);expect(Object.isFrozen(receipt)).toBe(true);
   }else{
    let rejected:{error:unknown}|undefined;try{await finishQualifiedSourceCallbacks(binding,occurrence,sourceSlot);}catch(error){rejected={error};}
    expect(rejected).toBeDefined();expect(rejected!.error).toBeInstanceOf(Error);
    expect((rejected!.error as Error).message).toBe(`qualified_core_callbacks:${fault==='forged-consumption'?'source_authentic_consumption':'source_exact_error_occurrence'}`);
   }
   expect(sourceSlot.outcome!.ok).toBe(false);expect(existsSync(root)).toBe(false);
  }catch(error){bodyFailure={error};}
  // Independently attempt each restore, including partial setup failures.
  const errors:unknown[]=bodyFailure?[bodyFailure.error]:[];
  try{writerRelease?.();}catch(error){errors.push(error);}
  try{await sourceObservation;}catch(error){errors.push(error);}
  try{if(binding?.role?.spy?.active)restoreQualifiedSourceFailureSpy(binding);}catch(error){errors.push(error);}
  try{save?.mockRestore();}catch(error){errors.push(error);}
  try{if(binding&&!binding.restored)restoreQualifiedSourceCallbacks(binding);}catch(error){errors.push(error);}
  if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'source_callback_test_and_restore_failed',{cause:errors[0]});
 });
}
