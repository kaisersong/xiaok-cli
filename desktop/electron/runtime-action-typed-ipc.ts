import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { RUNTIME_ACTION_METHODS, RUNTIME_ACTION_INPUTS, RUNTIME_ACTION_OUTPUTS } from '../shared/runtime-actions-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
// Check ambient descriptors before entering an async facade/SDK producer.
const preProducerWitness = new NativePromise<void>(resolve => resolve());
const owners = new WeakMap<IpcHandleRegistrar, ReadonlyMap<string, IpcHandlerListener>>();
export function registerRuntimeActionIpc(ipc: IpcHandleRegistrar, producers: ReadonlyMap<string, IpcHandlerListener>) {
  if (owners.has(ipc)) { if (owners.get(ipc) !== producers) throw Error('runtime_action_registrar_owner_conflict'); return; }
  const bindings = new Map(producers);
  for (const method of RUNTIME_ACTION_METHODS) {
    const channel = 'desktop:kswarm:' + method, output = RUNTIME_ACTION_OUTPUTS[method];
    registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel, output, payloadMode: 'tuple', rolloutRound: 35,
      sourceFile: 'desktop/electron/runtime-action-typed-ipc.ts', riskTags: ['external-process', 'network', 'fs-write'],
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const value = captureIpcData(raw, 'runtime_action_input_invalid');
        if (!RUNTIME_ACTION_INPUTS[method].safeParse(value).success) throw Error('runtime_action_input_invalid'); return value;
      }),
      handler: async (args, event) => {
        assertStandardIpcPromise(preProducerWitness, 'runtime_action_projection_unavailable');
        const producer = bindings.get(channel); if (!producer) throw Error('runtime_action_runtime_unavailable');
        const raw = producer(event, ...args); assertStandardIpcPromise(raw, 'runtime_action_projection_unavailable');
        return new NativePromise((resolve, reject) => apply(nativeThen, raw, [(value: unknown) => {
          try { const data = captureIpcData(value, 'runtime_action_projection_unavailable'); if (!output.safeParse(data).success) throw Error('runtime_action_projection_unavailable'); resolve(data); }
          catch (error) { reject(error); }
        }, reject]));
      },
    });
  }
  owners.set(ipc, producers);
}
