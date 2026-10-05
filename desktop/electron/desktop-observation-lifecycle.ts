import {desktopObservationSessionId} from '../../src/runtime/task-host/protected-observation-store.js';
import {existsSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {ReferenceDeletionReceiptStore} from '../../src/runtime/sol-pi/reference-lifecycle.js';
import {recoverTaskSnapshotSync} from '../../src/runtime/task-host/snapshot-store.js';
import {mergeProtectedObservationClosures,type ProtectedObservationClosure} from '../../src/ai/runtime/protected-observation-closure.js';
import {reconcileProductObservationReferences} from '../../src/runtime/sol-pi/product-bootstrap.js';
/** Main-owned journal bridge. No renderer-supplied closure, profile, or completion flag. */
export function createDesktopObservationLifecycle(options:{tasksRoot:string;profileRoot:string;getDeletionState(threadId:string):{operationId:string;completed:boolean}|undefined}){
 const reconcile=()=>reconcileProductObservationReferences(options.profileRoot).catch(()=>{/* Unknown/live profile owner retains pins; committed receipt is retried on startup. */});
 function recover(){
  if(!existsSync(join(options.profileRoot,'reference-deletions.sqlite')))return;
  const store=new ReferenceDeletionReceiptStore(options.profileRoot);try{for(const row of store.pending()){const state=options.getDeletionState(row.hostOwnerId??row.ownerId);if(state?.completed&&state.operationId===row.operationId)store.complete(row.id);}}finally{store.close();}
  return reconcile();
 }
 return{recover,beforeDelete(threadId:string,operationId:string):()=>void{
  const owners:Array<{ownerId:string;closure:ProtectedObservationClosure}>=[];const dir=join(options.tasksRoot,'snapshots');
  if(existsSync(dir))for(const name of readdirSync(dir)){
   if(!name.endsWith('.json'))continue;const path=join(dir,name);if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile())throw new Error('observation_reference_owner_unknown');
   const taskId=name.slice(0,-5);const snapshot=recoverTaskSnapshotSync(options.tasksRoot,taskId);
   if(!snapshot)throw new Error('observation_reference_owner_unknown');
   if(snapshot.context?.threadId===threadId&&snapshot.protectedObservationClosure){const sourceSessionId=desktopObservationSessionId(taskId);const closure=mergeProtectedObservationClosures(undefined,snapshot.protectedObservationClosure)!;if(closure.observations.some(ref=>ref.sourceSessionId!==sourceSessionId))throw new Error('observation_reference_owner_unknown');owners.push({ownerId:`session:${sourceSessionId}`,closure});}
  }
  if(!owners.some(owner=>owner.closure.observations.length))return()=>{};
  const store=new ReferenceDeletionReceiptStore(options.profileRoot);let receipts:string[];
  try{receipts=owners.filter(owner=>owner.closure.observations.length).map(owner=>store.begin({ownerId:owner.ownerId,hostOwnerId:threadId,operationId,references:owner.closure.observations,deletedAt:Date.now()}));}finally{store.close();}
  return()=>{const state=options.getDeletionState(threadId);if(!state?.completed||state.operationId!==operationId)throw new Error('observation_deletion_not_committed');const writer=new ReferenceDeletionReceiptStore(options.profileRoot);try{for(const receipt of receipts)writer.complete(receipt);}finally{writer.close();}void reconcile();};
 }};
}
