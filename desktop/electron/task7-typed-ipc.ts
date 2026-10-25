import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { TASK7_METHODS, TASK7_INPUTS, TASK7_OUTPUTS, TASK7_EVENT, TASK7_RISKS, type Task7Method } from '../shared/task7-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const environmentWitness = new NativePromise<void>(resolve => resolve());
const owners = new WeakMap<IpcHandleRegistrar, ReadonlyMap<string, IpcHandlerListener>>();
export function task7BeforeProducer(): void {
  assertStandardIpcPromise(environmentWitness, 'task_projection_unavailable');
}
/** Validate before any async assimilation; no thenable/constructor getter runs. */
export function callTask7Producer<T>(producer: () => Promise<T>): Promise<T> {
  task7BeforeProducer();
  const raw = producer();
  assertStandardIpcPromise(raw, 'task_projection_unavailable');
  return new NativePromise<T>((resolve, reject) => apply(nativeThen, raw, [(value: T) => {
    try { resolve(captureIpcData(value, 'task_projection_unavailable')); } catch (error) { reject(error); }
  }, reject]));
}
export function captureTask7Output<T>(method: Task7Method, value: T): T {
  const data = captureIpcData(value, 'task_projection_unavailable');
  if (!TASK7_OUTPUTS[method].safeParse(data).success) throw Error('task_projection_unavailable');
  return data;
}
export function captureTask7Event<T>(value: T): T {
  const data = captureIpcData(value, 'task_event_projection_unavailable');
  if (!TASK7_EVENT.safeParse(data).success) throw Error('task_event_projection_unavailable');
  return data;
}
export function registerTask7Ipc(ipc: IpcHandleRegistrar, producers: ReadonlyMap<string, IpcHandlerListener>, authorize: (event: IpcMainInvokeEvent) => void): void {
  if (owners.has(ipc)) { if (owners.get(ipc) !== producers) throw Error('task_registrar_owner_conflict'); return; }
  const bindings = new Map(producers);
  for (const method of TASK7_METHODS) {
    const channel = 'desktop:' + method;
    if (!bindings.has(channel)) throw Error('task_runtime_unavailable');
  }
  for (const method of TASK7_METHODS) {
    const channel = 'desktop:' + method;
    registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel, payloadMode: 'tuple', rolloutRound: 35,
      beforeInput: event => { authorize(event); return undefined; },
      beforeOutput: event => { authorize(event); return undefined; },
      sourceFile: 'desktop/electron/task7-typed-ipc.ts', riskTags: [...TASK7_RISKS[method]], output: TASK7_OUTPUTS[method],
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const data = captureIpcData(raw, 'task_input_invalid');
        if (!TASK7_INPUTS[method].safeParse(data).success) throw Error('task_input_invalid');
        return data;
      }),
      handler: async (args, event) => {
        // Witness must run BEFORE entering an async producer that could start an SDK.
        const result = await callTask7Producer(() => bindings.get(channel)!(event, ...args) as Promise<unknown>);
        return captureTask7Output(method, result);
      },
    });
  }
  owners.set(ipc, producers);
}
