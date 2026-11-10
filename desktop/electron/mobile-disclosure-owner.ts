import {readOriginalDesktopContinuityMain} from './desktop-services.js';
import {FileTaskSnapshotStore} from '../../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
import type {TaskHistoryRead} from '../shared/task-history.js';
import {ContinuitySdkCustody} from './context-continuity/sdk-custody.js';
import {encodeStrictMobileJson,MobileDisclosureError,type MobileDisclosureRoute} from './mobile-disclosure.js';

/** Private Main read provenance. Neither a matching DTO nor a transport token
 * can mint a read cut. This owner does not certify execution or Native IO. */
export function createOriginalMobileDisclosureOwner(services:object){
 const source=readOriginalDesktopContinuityMain(services),sdk=new ContinuitySdkCustody();
 const cuts=new WeakMap<object,{reads:TaskHistoryRead[];failed:boolean;kind:'tasks'|'user_ack'}>();
 const outputs=new WeakMap<object,{route:MobileDisclosureRoute;cut:object;encoded:string}>();
 const inspect=FileTaskSnapshotStore.prototype.inspectPersistedInventory;
 let closed=false;
 function local(){if(closed)throw new MobileDisclosureError();sdk.invokeSync<void>(source.assertCurrent,undefined,[]);}
 function current(cut:object):void{
  const row=cuts.get(cut);if(!row||row.failed)throw new MobileDisclosureError();
  try{local();for(const read of row.reads)sdk.invokeSync<void>(source.assertTaskHistoryCurrent,undefined,[read]);local();}
  catch(raw){row.failed=true;throw raw;}
 }
 function ticket(reads:TaskHistoryRead[],kind:'tasks'|'user_ack'='tasks'){const cut=Object.freeze({});cuts.set(cut,{reads,failed:false,kind});current(cut);return cut;}
 async function task(taskId:string){local();const read=await sdk.invoke<TaskHistoryRead>(source.readTaskHistory,undefined,[taskId]);local();const cut=ticket([read]);return Object.freeze({cut,snapshot:read.snapshot,presentation:read.presentation});}
 return Object.freeze({
  async recentTasks(limit:number){
   local();if(!Number.isSafeInteger(limit)||limit<1||limit>30)throw new MobileDisclosureError();
   const rows=await sdk.invoke<TaskSnapshot[]>(inspect,source.snapshotStore,[]);local();
   const selected=[...rows].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,limit),reads:TaskHistoryRead[]=[];
   for(const row of selected){local();const read=await sdk.invoke<TaskHistoryRead>(source.readTaskHistory,undefined,[row.taskId]);local();if(read.snapshot.taskId!==row.taskId||read.snapshot.sessionId!==row.sessionId)throw new MobileDisclosureError();reads.push(read);}
   const cut=ticket(reads),snapshots=Object.freeze(reads.map(read=>Object.freeze({...read.snapshot,prompt:read.presentation?.includeUser?read.presentation.prompt:''})));
   return Object.freeze({cut,snapshots});
  },
  task,
  assertCurrent:current,
  /** Only Main's user-input acknowledgement can use this cut. */
  emptyCut(){local();return ticket([],'user_ack');},
  bind<T extends object>(route:MobileDisclosureRoute,value:T,cut:object):T{current(cut);if(cuts.get(cut)?.kind==='user_ack'&&route!=='chat.send')throw new MobileDisclosureError();const encoded=encodeStrictMobileJson(value);current(cut);outputs.set(value,{route,cut,encoded});return value;},
  assertOutputCurrent(route:MobileDisclosureRoute,value:unknown):void{
   if(!value||typeof value!=='object')throw new MobileDisclosureError();const row=outputs.get(value);
   if(!row||row.route!==route)throw new MobileDisclosureError();current(row.cut);
   if(encodeStrictMobileJson(value)!==row.encoded)throw new MobileDisclosureError();current(row.cut);
  },
  close(){closed=true;return sdk.waitKnown();},
 });
}
