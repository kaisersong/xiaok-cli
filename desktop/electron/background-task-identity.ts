import {randomUUID} from 'node:crypto';
import type {InProcessTaskRuntimeHost,TaskIdentityReservation} from '../../src/runtime/task-host/task-runtime-host.js';
import type {TaskCreateInput} from '../../src/runtime/task-host/types.js';
import {captureLoopProducerValue} from './loop-scan-publication-body.js';
import {captureLoopRunContext} from './loop-run-context.js';
type BackgroundInput=Pick<TaskCreateInput,'prompt'|'materials'|'permissionMode'|'watchdogMs'|'maxToolLoopIterations'>;
interface Entry {owner:object;input:TaskCreateInput;reservation:TaskIdentityReservation;controls:Set<object>;guard:()=>void}
const controls=new WeakMap<object,Entry>();
/** Only the actual Main service constructs this controller. No IPC creates controls. */
export function createBackgroundTaskIdentityController(options:{host:InProcessTaskRuntimeHost;assertAdmission:()=>void;captureAdmission:()=>()=>void;create:(input:TaskCreateInput,reservation:TaskIdentityReservation,guard:()=>void)=>Promise<{taskId:string}>}) {
 const owner=Object.freeze({}),owned=new Set<object>(),reserve=options.host.reserveTaskIdentity.bind(options.host),assertReservation=options.host.assertTaskIdentityReservation.bind(options.host),admission=options.assertAdmission,captureAdmission=options.captureAdmission,create=options.create;let closed=false;
 function current(){if(closed)throw Error('background_identity_closed');const value:unknown=admission();if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('background_identity_admission_sync');}if(closed)throw Error('background_identity_closed');}
 function take(control:object){const entry=controls.get(control);controls.delete(control);entry?.controls.delete(control);if(!entry||entry.owner!==owner)throw Error('background_identity_control');return entry;}
 return Object.freeze({
  reserve(raw:BackgroundInput,context:{requestSource:'user'|'agent'|'scheduler'}){
   const source=captureLoopRunContext(context),input=captureLoopProducerValue(raw);
   if(Object.keys(input).some(k=>!['prompt','materials','permissionMode','watchdogMs','maxToolLoopIterations'].includes(k))||typeof input.prompt!=='string'||!Array.isArray(input.materials))throw Error('background_identity_input');
   current();const guard=captureAdmission();if(typeof guard!=='function')throw Error('background_identity_guard');const reservation=reserve(),control=Object.freeze({});controls.set(control,{owner,guard,input:{...input,context:{threadId:`local_${randomUUID()}`}},reservation,controls:owned});owned.add(control);void source;
   return Object.freeze({taskId:reservation.taskId,control});
  },
  async create(control:object,extraGuard?:()=>void){const entry=take(control);const guard=()=>{for(const check of [entry.guard,extraGuard]){if(!check)continue;const value:unknown=check();if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('background_identity_admission_sync');}}};current();guard();assertReservation(entry.reservation);const result=await create(entry.input,entry.reservation,guard);if(result.taskId!==entry.reservation.taskId)throw Error('background_identity_changed');return result;},
  discard(control:object){take(control);},
  close(){closed=true;for(const control of owned)controls.delete(control);owned.clear();},
 });
}
