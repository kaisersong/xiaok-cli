import { types } from 'node:util';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { SERVICE_CONTROL_OUTPUT_SCHEMAS, type ServiceControlMethod } from '../shared/service-control-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply, isPromise = types.isPromise;
export function captureServiceControlOutput(method: ServiceControlMethod, raw: unknown): unknown {
  const code = method === 'getStatus' ? 'service_projection_unavailable' : 'service_operation_unknown';
  const snapshot = captureIpcData(raw, code);
  if (!SERVICE_CONTROL_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error(code);
  return snapshot;
}
/** Capture before any await/custom then assimilation, including the SDK boundary. */
export function resolveServiceControlOutput(method: ServiceControlMethod, raw: unknown): Promise<unknown> {
  if (!isPromise(raw)) return new NativePromise(resolve => resolve(captureServiceControlOutput(method, raw)));
  assertStandardIpcPromise(raw, method === 'getStatus' ? 'service_projection_unavailable' : 'service_operation_unknown');
  return new NativePromise((resolve, reject) => apply(nativeThen, raw, [(value: unknown) => {
    try { resolve(captureServiceControlOutput(method, value)); } catch (error) { reject(error); }
  }, reject]));
}
