import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import type {NativeActor} from '../codex-native-service.js';
import type {LocalLegacyTaskArchive} from '../../shared/local-legacy-task-archive.js';
import {projectPublicTaskMessages} from '../../shared/context-continuity-projection.js';
import {ContinuitySdkCustody} from './sdk-custody.js';
import {digest,effectSnapshotHash} from './store.js';

interface Owner{store:FileTaskSnapshotStore;authorize(taskId:string,actor:NativeActor):Promise<void>;assertSnapshot(snapshot:TaskSnapshot,actor:NativeActor):void;assertOpen():void;}
/** Actual private-file reads only; never recovery, claim, or completion observation. */
export function createLocalLegacyTaskArchive(owner:Owner){
 const inspect=FileTaskSnapshotStore.prototype.inspectPersistedTask,sdk=new ContinuitySdkCustody();let closed=false;
 const reads=new WeakMap<object,{actor:NativeActor;snapshot:TaskSnapshot;hash:string;projection:string}>();
 const assertOpen=()=>{owner.assertOpen();if(closed)throw Error('local_legacy_archive_unavailable');};
 function assertCurrent(value:LocalLegacyTaskArchive,actor:NativeActor){
  assertOpen();const read=reads.get(value);if(!read||read.actor!==actor||read.hash!==effectSnapshotHash(read.snapshot)||read.projection!==digest(value))throw Error('local_legacy_archive_unavailable');
  owner.assertSnapshot(read.snapshot,actor);
 }
 return Object.freeze({
  async read(taskId:string,actor:NativeActor):Promise<LocalLegacyTaskArchive>{
   assertOpen();await owner.authorize(taskId,actor);
   const first=await sdk.invoke<TaskSnapshot|null>(inspect,owner.store,[taskId]);assertOpen();
   if(!first||first.taskId!==taskId)throw Error('local_legacy_archive_unavailable');owner.assertSnapshot(first,actor);
   const hash=effectSnapshotHash(first),last=await sdk.invoke<TaskSnapshot|null>(inspect,owner.store,[taskId]);
   assertOpen();await owner.authorize(taskId,actor);
   if(!last||last.taskId!==taskId||last.sessionId!==first.sessionId||effectSnapshotHash(last)!==hash)throw Error('local_legacy_archive_changed');owner.assertSnapshot(last,actor);
   const messages=projectPublicTaskMessages({...last,prompt:''}).filter(message=>message.role==='assistant').map(message=>Object.freeze({sourceMessageId:message.sourceMessageId,role:'assistant' as const,text:message.text}));
   const value=Object.freeze({taskId:last.taskId,sourceEpoch:last.sessionId,messages:Object.freeze(messages)});
   reads.set(value,{actor,snapshot:last,hash,projection:digest(value)});assertCurrent(value,actor);return value;
  },assertCurrent,stop(){closed=true;},async close(){closed=true;await sdk.waitKnown();},
 });
}
