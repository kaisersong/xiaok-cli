import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import type {TaskHistoryRead} from '../../shared/task-history.js';
import type {NativeActor} from '../codex-native-service.js';
import type {DesktopContextContinuity} from './runtime.js';
import {readPreparedTaskPresentation} from './task-presentation.js';
import {effectSnapshotHash,digest} from './store.js';
import {ContinuitySdkCustody} from './sdk-custody.js';
interface Owner{store:FileTaskSnapshotStore;runtime:DesktopContextContinuity;assertOpen():void;authorize(id:string,actor:NativeActor):Promise<void>;assertSnapshot(snapshot:TaskSnapshot,actor:NativeActor):void;}
/** Original asynchronous File Store read cut + live policy fences. This is
 * history data, never a physical execution receipt or Native qualification. */
export function createContinuityHistoryPort(owner:Owner){
 const inspect=FileTaskSnapshotStore.prototype.inspectPersistedTask,sdk=new ContinuitySdkCustody();
 const reads=new WeakMap<object,{actor:NativeActor;snapshot:TaskSnapshot;hash:string;presentation:string;fingerprint:string}>();
 const currentReads=new Map<string,TaskSnapshot>();let closed=false;
 const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){for(const key of Object.keys(value))freeze((value as Record<string,unknown>)[key]);Object.freeze(value);}};
 function assertCurrent(value:TaskHistoryRead,actor:NativeActor){owner.assertOpen();if(closed)throw Error('task_history_unavailable');const read=reads.get(value);if(!read||read.actor!==actor||read.hash!==effectSnapshotHash(value.snapshot)||read.presentation!==digest(value.presentation))throw Error('task_history_unavailable');owner.assertSnapshot(read.snapshot,actor);const presentation=readPreparedTaskPresentation(owner.runtime.port().service,read.snapshot);if(presentation.fingerprint!==read.fingerprint||digest(presentation.presentation)!==read.presentation)throw Error('task_history_unavailable');}
 return Object.freeze({
  async readTask(taskId:string,actor:NativeActor):Promise<TaskHistoryRead>{owner.assertOpen();if(closed)throw Error('task_history_unavailable');await owner.authorize(taskId,actor);const snapshot=await sdk.invoke<TaskSnapshot|null>(inspect,owner.store,[taskId]);owner.assertOpen();if(closed||!snapshot||snapshot.taskId!==taskId)throw Error('task_history_unavailable');await owner.authorize(taskId,actor);owner.assertSnapshot(snapshot,actor);const original=JSON.parse(JSON.stringify(snapshot)) as TaskSnapshot;freeze(original);currentReads.set(taskId,original);const presentation=readPreparedTaskPresentation(owner.runtime.port().service,original);const value={snapshot:original,presentation:presentation.presentation};freeze(value);reads.set(value,{actor,snapshot:original,hash:effectSnapshotHash(original),presentation:digest(value.presentation),fingerprint:presentation.fingerprint});assertCurrent(value,actor);return value;},
  assertCurrent,
  readCaptured(taskId:string):TaskSnapshot|null{return currentReads.get(taskId)??null;},
  stop(){closed=true;},async close(){closed=true;await sdk.waitKnown();},
 });
}
