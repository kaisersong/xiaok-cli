import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { types } from 'node:util';
import { SKILL_LIST_OUTPUT_SCHEMA } from '../shared/skill-list-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
/** Captures a documented async data boundary without awaiting an unknown constructor. */
export function captureSkillReadonlyPromise(raw: unknown, errorCode: string): Promise<unknown> {
  assertStandardIpcPromise(raw, errorCode);
  return new NativePromise((resolve, reject) => apply(nativeThen, raw, [
    (value: unknown) => { try { resolve(captureIpcData(value, errorCode, { preserveDataPrototype: true })); } catch (error) { reject(error); } },
    reject,
  ]));
}
export function captureSkillListServiceResult(raw: unknown, onCount: (count: number) => void): unknown {
  const capture = (value: unknown) => {
    const snapshot = captureIpcData(value, 'skill_list_projection_unavailable');
    if (!SKILL_LIST_OUTPUT_SCHEMA.safeParse(snapshot).success) throw Error('skill_list_projection_unavailable');
    onCount((snapshot as unknown[]).length); return snapshot;
  };
  if (!types.isPromise(raw)) return capture(raw);
  assertStandardIpcPromise(raw, 'skill_list_projection_unavailable');
  return new NativePromise((resolve, reject) => apply(nativeThen, raw, [
    (value: unknown) => { try { resolve(capture(value)); } catch (error) { reject(error); } }, reject,
  ]));
}
