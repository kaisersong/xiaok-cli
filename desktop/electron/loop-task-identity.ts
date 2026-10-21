import type {LoopStore} from './loop-store.js';import type {TaskCreateInput} from '../../src/runtime/task-host/types.js';
import {captureLoopProducerValue} from './loop-scan-publication-body.js';import {captureLoopRunContext} from './loop-run-context.js';import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
export interface LoopReservedTaskPort {
 reserveTask(input:TaskCreateInput,context:{requestSource:'user'|'agent'|'scheduler'}):{taskId:string;control:object}|Promise<{taskId:string;control:object}>;
 createReservedTask(control:object,assertAdmission?:()=>void):Promise<{taskId:string}>;discardReservedTask(control:object):void;
}
interface Ticket{store:LoopStore;runId:string;stageId:string;taskId:string;vector:string}
const tickets=new WeakMap<object,Ticket>(),pending=new WeakSet<object>();
export function loopTaskIdentityVector(store:LoopStore,runId:string){const run=store.getLoopRun(runId);return json(captureLoopProducerValue({run:run??null,stages:store.listLoopStages(runId),basis:store.getLoopRunPublicationBasis(runId)??null,definition:run?store.getLoopDefinition(run.loopId)??null:null,config:run?store.getLoopPublicationConfiguration(run.loopId)??null:null}));}
export function consumeLoopTaskIdentity(token:object,store:LoopStore){const t=tickets.get(token);tickets.delete(token);if(!t||t.store!==store)throw Error('loop_task_identity_ticket');return t;}
export function isLoopTaskCreationPending(error:unknown){return !!error&&typeof error==='object'&&pending.has(error);}
/** Main supplies the actual bound reservation port. No DTO mint API. */
export function createLoopTaskIdentityHost(store:LoopStore,port:LoopReservedTaskPort){
 const reserve=port.reserveTask.bind(port),create=port.createReservedTask.bind(port),discard=port.discardReservedTask.bind(port),bind=store.bindLoopExecutionTaskIdentity.bind(store);
 return Object.freeze({async create(raw:TaskCreateInput,context:{runId:string;stageId:string;requestSource:'user'|'agent'|'scheduler';signal?:AbortSignal}){
  const input=captureLoopProducerValue(raw),source=captureLoopRunContext({requestSource:context.requestSource}),runId=context.runId,stageId=context.stageId,signal=context.signal,vector=loopTaskIdentityVector(store,runId);signal?.throwIfAborted();
  const reserved=await reserve(input,source);let bound=false;
  try{signal?.throwIfAborted();if(typeof reserved.taskId!=='string'||!reserved.taskId||loopTaskIdentityVector(store,runId)!==vector)throw Error('loop_task_identity_changed');
   const ticket=Object.freeze({});tickets.set(ticket,{store,runId,stageId,taskId:reserved.taskId,vector});let control:ReturnType<LoopStore['bindLoopExecutionTaskIdentity']>;try{control=bind(ticket);bound=true;}finally{tickets.delete(ticket);}
   signal?.throwIfAborted();const result=await create(reserved.control,control.assertCurrent);if(result.taskId!==reserved.taskId)throw Error('loop_task_identity_changed');signal?.throwIfAborted();control.markStarted();return result;
  }catch(cause){try{discard(reserved.control);}catch{}if(bound){const error=new Error('loop_task_creation_pending',{cause});pending.add(error);throw error;}throw cause;}
 }});
}

interface TerminalTicket {store:LoopStore;runId:string;stageId:string;taskId:string;vector:string;snapshot:import('../../src/runtime/task-host/types.js').TaskSnapshot}
const terminalTickets=new WeakMap<object,TerminalTicket>();
export function consumeLoopTaskTerminal(token:object,store:LoopStore){const entry=terminalTickets.get(token);terminalTickets.delete(token);if(!entry||entry.store!==store)throw Error('loop_task_terminal_ticket');return entry;}
/** Only the fixed Main TaskHost reader can establish an observed execution terminal. */
export function createLoopTaskTerminalObserver(store:LoopStore,port:{recoverTask(taskId:string):Promise<{snapshot:import('../../src/runtime/task-host/types.js').TaskSnapshot}>}){
 const read=port.recoverTask.bind(port),commit=store.recordLoopTaskTerminal.bind(store);
 return Object.freeze({async observe(raw:{runId:string;stageId:string;requestSource:'user'|'agent'|'scheduler'}){
  const input=captureLoopProducerValue(raw);if(Object.keys(input).sort().join(',')!=='requestSource,runId,stageId')throw Error('loop_task_terminal_shape');captureLoopRunContext({requestSource:input.requestSource});
  const vector=loopTaskIdentityVector(store,input.runId),stage=store.listLoopStages(input.runId).find(s=>s.id===input.stageId);
  if(!stage||stage.stageKind!=='execute'||typeof stage.metadata.taskId!=='string')throw Error('loop_task_identity_changed');
  const snapshot=captureLoopProducerValue((await read(stage.metadata.taskId)).snapshot);
  if(snapshot.taskId!==stage.metadata.taskId||loopTaskIdentityVector(store,input.runId)!==vector)throw Error('loop_task_identity_changed');
  if(!['completed','failed','cancelled'].includes(snapshot.status))return undefined;
  const token=Object.freeze({});terminalTickets.set(token,{store,runId:input.runId,stageId:stage.id,taskId:snapshot.taskId,vector,snapshot});
  try{commit(token);}finally{terminalTickets.delete(token);}return snapshot;
 }});
}
