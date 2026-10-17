// UNAPPROVED CANDIDATE. Target: desktop/electron/observation-typed-ipc.ts.
// Public DTO snapshots never carry or clone private approval/control capabilities.
import { z } from 'zod';
import { types } from 'node:util';
import type { IpcMainInvokeEvent } from 'electron';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler, type IpcRegistrationOptions } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
const NativePromise = Promise, apply = Reflect.apply, nativeThen = NativePromise.prototype.then;
// Private fulfilled witness; reject ambient species before entering any async producer.
const preProducerWitness = new NativePromise<void>(resolve => resolve());
const isPromise = types.isPromise, isProxy = types.isProxy;
const descriptors = Object.getOwnPropertyDescriptors, prototypeOf = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
export const OBSERVATION_METHODS = ['prepareObservationTask','createObservationTask','getObservationTaskStatus','stopObservationTask','revokeObservationTask'] as const;
type Method = typeof OBSERVATION_METHODS[number];
// Preserve the original TypeScript number contract; do not invent finite/min limits.
const number = z.custom<number>(value => typeof value === 'number');
const semantic = z.object({ mode:z.enum(['automatic','mechanism-experiment']), state:z.enum(['waiting','compacted','skipped','failed']), reason:z.enum(['economics','changed','no-gain','budget','unavailable']).optional(), attempts:number,maxAttempts:number,reservedCostUnits:number,maxCostUnits:number }).strict();
const step = z.enum(['not_started','pending','denied','succeeded','failed','cancelled','unknown']);
const compound = z.object({mode:z.literal('mechanism-experiment'),edit:step,validation:step,pendingOperations:number,unknownOperations:number,completedOperations:number}).strict();
const status = z.object({mode:z.string(),semantic:semantic.optional(),compound:compound.optional()}).strict();
export const OBSERVATION_OUTPUT = {
 prepareObservationTask:z.object({draftId:z.string(),expiresAt:number,model:z.string()}).strict().nullable(),
 createObservationTask:z.object({taskId:z.string()}).strict(),
 getObservationTaskStatus:status,stopObservationTask:status,revokeObservationTask:status,
};
const create = z.object({draftId:z.string(),prompt:z.string().max(100000).refine(value => !!value.trim()),threadId:z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/).optional()}).strict();
const control = z.object({taskId:z.string()}).strict();
const inputs = {
 prepareObservationTask:z.union([z.tuple([]),z.tuple([z.undefined()])]),
 createObservationTask:z.tuple([create]),
 getObservationTaskStatus:z.tuple([control]),stopObservationTask:z.tuple([control]),revokeObservationTask:z.tuple([control]),
};
export function observationOutputError(method:Method):string {
 return method === 'createObservationTask' ? 'observation_create_outcome_unknown' : method === 'stopObservationTask' || method === 'revokeObservationTask' ? 'observation_control_outcome_unknown' : 'observation_projection_unavailable';
}
/** Admit the producer before any assimilation; reuse the approved intrinsic Promise guard. */
export function settleObservationProducer<T>(value:unknown,error:string,project:(value:unknown)=>T):Promise<T> {
 if (!isPromise(value)) return NativePromise.resolve(project(value));
 assertStandardIpcPromise(value,error);
 return new NativePromise((resolve,reject) => {
  apply(nativeThen,value,[(result:unknown) => {try {resolve(project(result));} catch(failure) {reject(failure);}},(failure:unknown) => reject(failure)]);
 });
}
/** Inspect private creation descriptors without cloning or exposing the exact control identity. */
export function validateObservationCreation(value:unknown):{taskId:string;control:object} {
 const fail=():never=>{throw Error('observation_create_outcome_unknown');};
 if (!value || typeof value !== 'object' || isProxy(value)) return fail();
 const proto=prototypeOf(value);if(proto!==Object.prototype && proto!==null)return fail();
 const d=descriptors(value),keys=ownKeys(d);
 if(keys.length!==2 || !keys.includes('taskId') || !keys.includes('control') ||
  !d.taskId?.enumerable || !('value' in d.taskId) || typeof d.taskId.value !== 'string' ||
  !d.control?.enumerable || !('value' in d.control) || !d.control.value || typeof d.control.value !== 'object' || isProxy(d.control.value))return fail();
 return value as {taskId:string;control:object}; // Return the original Main-private object, not a snapshot.
}
/** Extract ONLY public facts from private diagnostics; unknown private metadata stays private. */
export function observationDiagnosticFacts(value:unknown):{semantic?:unknown;compound?:unknown} {
 if(value===undefined || value===null)return {};
 if(typeof value !== 'object' || isProxy(value))throw Error('observation_projection_unavailable');
 const proto=prototypeOf(value);if(proto!==Object.prototype&&proto!==null)throw Error('observation_projection_unavailable');
 const d=descriptors(value),result:{semantic?:unknown;compound?:unknown}={};
 for(const key of ['semantic','compound'] as const) {
  const field=d[key];if(!field)continue;
  if(!('value' in field))throw Error('observation_projection_unavailable');
  if(field.value)result[key]=captureIpcData(field.value,'observation_projection_unavailable');
 }
 return result;
}
/** The raw producers and their private Maps remain owned by the original IPC closure. */
export function createObservationRegistrar(ipc:IpcHandleRegistrar,authorize:(event:IpcMainInvokeEvent)=>void,round:IpcRegistrationOptions<unknown[],unknown>['rolloutRound']):IpcHandleRegistrar {
 const installed=new Set<string>();
 return {handle(channel:string,listener:IpcHandlerListener) {
  const method=channel.slice('desktop:'.length) as Method;
  if(channel!==`desktop:${method}` || !OBSERVATION_METHODS.includes(method) || installed.has(channel))throw Error('observation_registrar_conflict');
  const inputError=method==='prepareObservationTask'||method==='createObservationTask'?'observation_input_invalid':'observation_task_owner_required';
  const outputError=observationOutputError(method);
  registerIpcHandler<unknown[],unknown>({registrar:ipc,channel,payloadMode:'tuple',sourceFile:'desktop/electron/observation-typed-ipc.ts',rolloutRound:round,
   riskTags:method==='getObservationTaskStatus'?['fs-read']:['fs-read','fs-write','network'],
   beforeInput:event=>{authorize(event);return undefined;},
   input:z.custom<unknown[]>(()=>true).transform(raw=>{const snapshot=captureIpcData(raw,inputError);if(!inputs[method].safeParse(snapshot).success)throw Error(inputError);return snapshot;}),
   output:OBSERVATION_OUTPUT[method],
   handler:async(args,event)=>{
    assertStandardIpcPromise(preProducerWitness,outputError);
    return settleObservationProducer(apply(listener,undefined,[event,...args]),outputError,value=>{const snapshot=captureIpcData(value,outputError);if(!OBSERVATION_OUTPUT[method].safeParse(snapshot).success)throw Error(outputError);return snapshot;});
   },
   captureOutput:value=>captureIpcData(value,outputError),
   outputCheck:value=>{if(!OBSERVATION_OUTPUT[method].safeParse(value).success)throw Error(outputError);return undefined;},
  });
  installed.add(channel);
 }};
}
