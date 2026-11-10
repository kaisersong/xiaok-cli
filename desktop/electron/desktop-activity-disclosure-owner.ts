import {readOriginalDesktopContinuityMain} from './desktop-services.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import {encodeStrictMobileJson} from './mobile-disclosure.js';
import {ContinuitySdkCustody} from './context-continuity/sdk-custody.js';
import {isUnavailableProjection,isUnavailableActivity} from '../../src/runtime/conversation-activity/disclosure.js';
import type {TaskHistoryRead} from '../shared/task-history.js';
import type {WorkWatch,ConversationActivity,ConversationWorkView} from '../../src/runtime/conversation-activity/types.js';
import type {ActivityActor} from '../../src/runtime/conversation-activity/service.js';

/** Same-factory Main source only. The socket/view itself is never a read grant. */
export function createOriginalActivityDisclosureOwner(services:object){
 const source=readOriginalDesktopContinuityMain(services),sdk=new ContinuitySdkCustody();let closed=false;
 const records=new WeakMap<object,{actorId:string;reads:TaskHistoryRead[];watches:WorkWatch[];encoded:string;failed:boolean}>();
 function local(){if(closed)throw Error('activity_source_forbidden');sdk.invokeSync<void>(source.assertCurrent,undefined,[]);}
 function watchCurrent(watch:WorkWatch,actor:ActivityActor){
  local();if(actor.requestSource!=='user'||actor.actorId!==`desktop-user:${watch.origin.profileId}`)throw Error('activity_actor_forbidden');
  const now=sdk.invokeSync<WorkWatch|null>(source.readActivityWatch,undefined,[watch.watchId]);
  if(!now||encodeStrictMobileJson(now)!==encodeStrictMobileJson(watch))throw Error('activity_source_superseded');local();
 }
 function current(raw:unknown,actor:ActivityActor):void{
  if(!raw||typeof raw!=='object')throw Error('activity_source_forbidden');const record=records.get(raw);if(!record||record.failed||record.actorId!==actor.actorId)throw Error('activity_source_forbidden');
  try{local();for(const watch of record.watches)watchCurrent(watch,actor);for(const read of record.reads)sdk.invokeSync<void>(source.assertTaskHistoryCurrent,undefined,[read]);if(encodeStrictMobileJson(raw)!==record.encoded)throw Error('activity_source_superseded');local();}
  catch(first){record.failed=true;throw first;}
 }
 async function capture<T extends ConversationWorkView|ConversationActivity[]>(raw:T,actor:ActivityActor):Promise<T>{
  local();const data=captureIpcData(raw),items=Array.isArray(data)?data:[data];
  const reads:TaskHistoryRead[]=[],watches:WorkWatch[]=[];
  for(const item of items){
   const id='watch'in item?item.watch.watchId:item.watchId;const watch=sdk.invokeSync<WorkWatch|null>(source.readActivityWatch,undefined,[id]);
   if(!watch)throw Error('activity_source_forbidden');watchCurrent(watch,actor);watches.push(watch);
   if('watch'in item){if(encodeStrictMobileJson(item.watch)!==encodeStrictMobileJson(watch))throw Error('activity_source_superseded');}
   else if(item.threadId!==watch.origin.threadId)throw Error('activity_source_forbidden');
   const neutral='watch'in item?isUnavailableProjection(item.projection):isUnavailableActivity(item);
   if(!neutral&&watch.source==='task_host'){
    const read=await sdk.invoke<TaskHistoryRead>(source.readTaskHistory,undefined,[watch.workId]);watchCurrent(watch,actor);
    if(read.snapshot.taskId!==watch.workId||read.snapshot.sessionId!==watch.sourceDataEpoch||read.snapshot.context?.threadId!==(watch.actualExecutionThreadId??watch.origin.threadId))throw Error('activity_source_forbidden');
    sdk.invokeSync<void>(source.assertTaskHistoryCurrent,undefined,[read]);reads.push(read);
   }
  }
  records.set(raw,{actorId:actor.actorId,reads,watches,encoded:encodeStrictMobileJson(raw),failed:false});current(raw,actor);return raw;
 }
 return Object.freeze({capture,assertCurrent:current,close(){closed=true;return sdk.waitKnown();}});
}
