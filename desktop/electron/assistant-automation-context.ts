import type {TimedActionRecord,TimedActionRunRecord} from './timed-action-types.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
import {redactSecrets} from '../../src/shared/stream-safety/redact.js';
interface Ports {canRead?():boolean;listActions():TimedActionRecord[];listRuns(id:string):TimedActionRunRecord[];readTask(id:string):TaskSnapshot|undefined|null|Promise<TaskSnapshot|undefined|null>}
/** Read only Main-owned facts, never the morning model's interpretation. */
export async function readAssistantAutomationContext(ports:Ports,asOf=Date.now()){
 const items:Array<{actionId:string;title:string;scheduleStatus:string;nextDueAt?:number;runId?:string;dispatchStatus?:string;startedAt?:number;runtimeTaskId?:string;runtimeStatus:string;hostSettlement?:string;summary?:string;summaryTruncated?:boolean;summaryOmitted?:boolean;error?:string}>=[];
 try{
  if(ports.canRead&&!ports.canRead())return {asOf,state:'unavailable' as const,limited:false,items};
  let remaining=24000;
  const actions=ports.listActions().filter(a=>a.ownerKind==='user'&&a.executor.kind==='agent_task').sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
  for(const action of actions.slice(0,30)){
   const item:typeof items[number]={actionId:action.id,title:action.title,scheduleStatus:action.status,nextDueAt:action.nextDueAt,runtimeStatus:'not_run'};items.push(item);
   try{
    const run=ports.listRuns(action.id).filter(r=>r.actionId===action.id).sort((a,b)=>b.startedAt-a.startedAt||b.runId.localeCompare(a.runId))[0];if(!run)continue;
    Object.assign(item,{runId:run.runId,dispatchStatus:run.status,startedAt:run.startedAt,runtimeTaskId:run.runtimeTaskId,runtimeStatus:run.runtimeTaskId?'unavailable':'not_started'});
    if(!run.runtimeTaskId)continue;
    const task=await ports.readTask(run.runtimeTaskId);if(!task||task.taskId!==run.runtimeTaskId)continue;
    if(task.executionProtected){item.runtimeStatus='protected';continue;}
    item.runtimeStatus=task.status;item.hostSettlement=task.hostDelivery?.hostSettlement;
    if(task.status==='completed'&&task.result?.summary){const text=redactSecrets(task.result.summary).text;const size=Math.min(16000,remaining);if(size>0){item.summary=text.slice(0,size);remaining-=item.summary.length;}else item.summaryOmitted=true;item.summaryTruncated=text.length>size;}
    if(task.status==='failed')item.error='runtime_failed';
   }catch{item.runtimeStatus='unavailable';}
  }
  return {asOf,state:'available' as const,limited:actions.length>30,items};
 }catch{return {asOf,state:'unavailable' as const,limited:false,items:[]};}
}
