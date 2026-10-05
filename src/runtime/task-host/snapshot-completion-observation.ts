import {observeInstalledCompletion,observeInstalledCompletionSync,type InstalledCompletionObservation} from '../verification/installed-completion-observation.js';
import type {TaskSnapshot} from './types.js';
/** Durable snapshots contain execution history, never cached verification authority. */
export function withoutTaskCompletionObservation(snapshot:TaskSnapshot):TaskSnapshot{
 const {currentCompletion:ignored,...execution}=snapshot;return execution;
}
function project(snapshot:TaskSnapshot,observation:Readonly<InstalledCompletionObservation>):TaskSnapshot{
 const execution=withoutTaskCompletionObservation(snapshot);
 if(observation.kind==='ordinary')return execution;
 if(observation.kind==='unavailable')return {...execution,currentCompletion:Object.freeze({kind:'unavailable'})};
 const state=observation.state;
 return {...execution,currentCompletion:Object.freeze({kind:'protected',state:Object.freeze({...state,owner:Object.freeze({...state.owner})})})};
}
export async function observeTaskSnapshotCompletion(snapshot:TaskSnapshot,taskId:string,signal?:AbortSignal):Promise<TaskSnapshot>{
 if(snapshot.taskId!==taskId)throw Error('task_snapshot_completion_owner');
 return project(snapshot,await observeInstalledCompletion({ownerKind:'task',ownerId:taskId},signal));
}
export function observeTaskSnapshotCompletionSync(snapshot:TaskSnapshot,taskId:string):TaskSnapshot{
 if(snapshot.taskId!==taskId)throw Error('task_snapshot_completion_owner');
 return project(snapshot,observeInstalledCompletionSync({ownerKind:'task',ownerId:taskId}));
}
