// UNREVIEWED CANDIDATE: reuses reviewed descriptor serializer and native Promise gate.
import { types } from 'node:util';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { MATERIAL_ACCESS_INPUTS, MATERIAL_ACCESS_OUTPUTS, type MaterialAccessMethod } from './material-access-ipc-contract.js';
const NativePromise = Promise, then = Promise.prototype.then, apply = Reflect.apply, isPromise = types.isPromise;
const witness = new NativePromise<void>(resolve => resolve());
export function assertMaterialAccessEnvironment(): void { assertStandardIpcPromise(witness,'material_access_projection_unavailable'); }
export function captureMaterialAccessInput(method: MaterialAccessMethod, raw: unknown): unknown[] {
  const snapshot = captureIpcData(raw,'material_access_input_invalid');
  if (!MATERIAL_ACCESS_INPUTS[method].safeParse(snapshot).success) throw Error('material_access_input_invalid');
  return snapshot as unknown[];
}
export function captureMaterialAccessOutput(method: MaterialAccessMethod, raw: unknown): unknown {
  const snapshot = captureIpcData(raw,'material_access_projection_unavailable');
  if (!MATERIAL_ACCESS_OUTPUTS[method].safeParse(snapshot).success) throw Error('material_access_projection_unavailable');
  return snapshot;
}
/** Never awaits a caller-defined then/constructor or serializes a raw projection. */
export function captureMaterialAccessPromise<T, R>(raw: Promise<T>, capture: (raw: T) => R): Promise<R> {
  assertStandardIpcPromise(raw,'material_access_projection_unavailable');
  return new NativePromise((resolve,reject) => apply(then,raw,[(value:unknown) => { try { resolve(capture(value as T)); } catch (error) { reject(error); } },reject]));
}
export function captureMaterialAccessValue<T>(raw: unknown, capture: (raw: unknown) => T): T | Promise<T> {
  return isPromise(raw) ? captureMaterialAccessPromise(raw,capture) : capture(raw);
}
export function materialAccessError(raw: unknown): string {
  const snapshot = !types.isProxy(raw) && raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw,'message') : undefined;
  const message = snapshot && 'value' in snapshot ? snapshot.value : undefined;
  return typeof message === 'string' && ['material_access_input_invalid','material_access_projection_unavailable','material_access_runtime_unavailable','request_source_user_required','material_task_path','material_index_readonly'].includes(message)
    ? message : 'material_access_operation_failed';
}
