// UNAPPROVED DESIGN15 DELTA. Target desktop/electron/observation-service-facade.ts.
// A transport facade, not a replacement controller or approval authority.
import type { createDesktopServices } from './desktop-services.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { settleObservationProducer, validateObservationCreation, observationDiagnosticFacts } from './observation-typed-ipc.js';
const NativePromise = Promise, apply = Reflect.apply;
const preProducerWitness = new NativePromise<void>(resolve => resolve());
type Service = Pick<ReturnType<typeof createDesktopServices>, 'createObservationTask'|'stopObservationTask'|'revokeObservationTask'|'observationTaskStatus'|'observationTaskDiagnostics'>;
const createError = 'observation_create_outcome_unknown', controlError = 'observation_control_outcome_unknown', readError = 'observation_projection_unavailable';
function expectVoid(value:unknown):undefined { if(value!==undefined)throw Error(controlError);return undefined; }
/** Every business producer is called synchronously AFTER private ambient preflight.
 * Methods are deliberately not async: a denied preflight creates no inner producer Promise.
 * Forward private authority and control by exact identity. Never DTO-clone these arguments.
 */
export function createObservationServiceFacade(service:Service) {
 return {
  createObservationTask(input:Parameters<Service['createObservationTask']>[0],authority:Parameters<Service['createObservationTask']>[1]) {
   assertStandardIpcPromise(preProducerWitness,createError);
   return settleObservationProducer(apply(service.createObservationTask,service,[input,authority]),createError,validateObservationCreation);
  },
  stopObservationTask(taskId:string,context:Parameters<Service['stopObservationTask']>[1]) {
   assertStandardIpcPromise(preProducerWitness,controlError);
   return settleObservationProducer(apply(service.stopObservationTask,service,[taskId,context]),controlError,expectVoid);
  },
  revokeObservationTask(taskId:string,context:Parameters<Service['revokeObservationTask']>[1]) {
   assertStandardIpcPromise(preProducerWitness,controlError);
   return settleObservationProducer(apply(service.revokeObservationTask,service,[taskId,context]),controlError,expectVoid);
  },
  observationTaskStatus(taskId:string) {
   assertStandardIpcPromise(preProducerWitness,readError);
   return settleObservationProducer(apply(service.observationTaskStatus,service,[taskId]),readError,value=>{if(typeof value!=='string')throw Error(readError);return value;});
  },
  observationTaskDiagnosticFacts(taskId:string) {
   assertStandardIpcPromise(preProducerWitness,readError);
   const producer = service.observationTaskDiagnostics;
   return observationDiagnosticFacts(producer == null ? undefined : apply(producer,service,[taskId]));
  },
 };
}
