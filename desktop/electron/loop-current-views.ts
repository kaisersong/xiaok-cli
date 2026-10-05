import {buildAutomationRunHistory,type AutomationRunHistoryItem} from './automation-overview.js';
import {createLoopBusinessPublicationHost,consumeLoopCompletedRun,isLoopCompletionNotCurrent,type LoopCompletionRequest} from './loop-business-publication-host.js';
import {executionIdentity} from './loop-verification-execution.js';
import type {LoopStore} from './loop-store.js';
import type {TimedActionStore} from './timed-action-store.js';
import type {LoopRun} from './loop-types.js';
import type {IpcHandleRegistrar,DesktopShutdownGate} from './shutdown-aware-ipc-main.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
import type {LoopCompletionObservation} from '../shared/loop-current-view-types.js';
export type LoopRunObservationView=LoopRun&{businessState:LoopRun['status']|'publication_pending';completionObservation?:LoopCompletionObservation};
/** Read observations are dated display facts, never reusable business authority. */
export function createLoopCurrentViews(options:{loopStore:LoopStore;timedStore:TimedActionStore;gate:DesktopShutdownGate;captureAdmission():()=>void;taskPort?:{recoverTask(id:string):Promise<TaskSnapshot|undefined>};now?:()=>number}){
 const {loopStore,timedStore,gate}=options,capture=options.captureAdmission.bind(options),now=options.now??Date.now,lifetime=new AbortController(),pending=new Set<Promise<unknown>>();let closed=false;
 async function read<T>(rows:()=>T[],runId:(row:T)=>string|undefined,project:(row:T,observation:LoopCompletionObservation|undefined)=>T):Promise<T[]>{
  if(closed)throw Error('loop_view_closed');const writer=gate.acquire('external','loop-current-view');
  let host:ReturnType<typeof createLoopBusinessPublicationHost>|undefined;
  try{
   const admission=capture(),signal=lifetime.signal;
   const check=()=>{signal.throwIfAborted();if(closed||!gate.isOpen)throw Error('loop_view_closed');const value:unknown=admission();if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('loop_view_admission_sync');}signal.throwIfAborted();};check();
   const version=()=>`${loopStore.getAutomationStoreVersion()}:${timedStore.getAutomationStoreVersion()}`,originalVersion=version(),original=rows(),rowIds=new Map(original.map(row=>[row,runId(row)])),ids=[...new Set([...rowIds.values()].filter((id):id is string=>!!id))];
   host=createLoopBusinessPublicationHost({store:loopStore,assertAdmission:check,taskPort:options.taskPort});
   const results=new Map<string,LoopCompletionObservation>(),tickets:{id:string;input:LoopCompletionRequest;ticket:object}[]=[];
   for(const id of ids){
    const run=loopStore.getLoopRun(id);if(!run){results.set(id,{state:'needs_revalidation',checkedAt:now()});continue;}if(run.status!=='success')continue;
    const input={runId:id,loopId:run.loopId,logicalRunKey:run.logicalRunKey??null,requestSource:'user' as const,signal};
    try{const ticket=await host.prepareCompletedRun(input);check();tickets.push({id,input,ticket});results.set(id,{state:'verified_at_read',checkedAt:now()});}
    catch(error){check();if(!isLoopCompletionNotCurrent(error))throw error;results.set(id,{state:'needs_revalidation',checkedAt:now()});}
   }
   check();
   for(const {id,input,ticket} of tickets){try{consumeLoopCompletedRun(loopStore,input,ticket);}catch(error){check();if(!isLoopCompletionNotCurrent(error))throw error;results.set(id,{state:'needs_revalidation',checkedAt:now()});}}
   if(version()!==originalVersion)for(const id of results.keys())results.set(id,{state:'needs_revalidation',checkedAt:now()});
   check();return original.map(row=>project(row,results.get(rowIds.get(row)??'')));
  }finally{try{await host?.close();}finally{writer.release();}}
 }
 function track<T>(work:Promise<T>):Promise<T>{pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;}
 function getLoopRuns(raw:unknown):Promise<LoopRunObservationView[]>{
  try{executionIdentity(raw);return track(read<LoopRunObservationView>(()=>loopStore.listLoopRuns(raw,20).map(run=>({...run,businessState:loopStore.getLoopRunLifecycle(run.id)?.businessState??run.status})),row=>row.id,(row,observation)=>({...row,...(observation?{completionObservation:observation,businessState:observation.state==='verified_at_read'?'success' as const:'publication_pending' as const}:{})})));}catch(error){return Promise.reject(error);}
 }
 function historyRunId(row:AutomationRunHistoryItem):string|undefined {
  if(!row.loopRunId||row.automationKind!=='loop')return undefined;
  if(!row.scheduleRunId)return row.loopRunId;
  if(!row.actionId)return undefined;
  const target=timedStore.getLoopTimedTarget(row.actionId,row.scheduleRunId);if(target.run.executorKind!=='loop')return undefined;const receipt=timedStore.getLoopTimedReceipt(row.scheduleRunId);if(receipt)return receipt.loopRunId===row.loopRunId&&receipt.disposition!=='rejected'?row.loopRunId:undefined;const run=loopStore.getLoopRun(row.loopRunId);return run?.trigger.timedActionId===row.actionId&&run.trigger.timedActionRunId===row.scheduleRunId?row.loopRunId:undefined;
 }
 function getRunHistory():Promise<AutomationRunHistoryItem[]>{return track(read<AutomationRunHistoryItem>(()=>buildAutomationRunHistory({loopStore,timedActionStore:timedStore}).map(row=>({...row,historyStatus:row.historyStatus??row.status})),historyRunId,(row,observation)=>({...row,...(observation?{completionObservation:observation,status:observation.state==='verified_at_read'?'success' as const:'publication_pending' as const}:row.automationKind==='loop'&&row.status==='success'?{status:'publication_pending' as const,completionObservation:{state:'needs_revalidation' as const,checkedAt:now()}}:{})})));}
 return Object.freeze({getLoopRuns,getRunHistory,async close(){closed=true;lifetime.abort(Error('loop_view_closed'));await Promise.allSettled([...pending]);}});
}
export type LoopCurrentViews=ReturnType<typeof createLoopCurrentViews>;

export function registerLoopCurrentViewIpc(ipc:IpcHandleRegistrar,service:LoopCurrentViews,authorize:(event:unknown)=>boolean):void {
 ipc.handle('desktop:loops:listRuns',(event,...args)=>{if(!authorize(event)||args.length!==1)throw Error('loop_view_ipc_denied');executionIdentity(args[0]);return service.getLoopRuns(args[0]);});
 ipc.handle('desktop:automations:getRunHistory',(event,...args)=>{if(!authorize(event)||args.length!==0)throw Error('loop_view_ipc_denied');return service.getRunHistory();});
}
