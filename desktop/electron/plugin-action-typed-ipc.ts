import { z } from 'zod';
import { registerIpcHandler } from './ipc-runtime.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { capturePluginActionInput, capturePluginActionOutput, pluginActionCode } from './plugin-action-service.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { PLUGIN_ACTION_METHODS, PLUGIN_ACTION_OUTPUTS, PLUGIN_ACTION_RISKS } from '../shared/plugin-action-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
// Private fulfilled witness checks intrinsic integrity before starting a producer.
const environmentWitness = new NativePromise<void>(resolve => resolve());
const owners = new WeakMap<IpcHandleRegistrar, ReadonlyMap<string, IpcHandlerListener>>();
export function registerPluginActionIpc(ipc: IpcHandleRegistrar, producers: ReadonlyMap<string, IpcHandlerListener>): void {
  if (owners.has(ipc)) { if (owners.get(ipc) !== producers) throw Error('plugin_action_registrar_owner_conflict'); return; }
  const bindings = new Map(producers);
  for (const method of PLUGIN_ACTION_METHODS) {
    const channel = 'desktop:' + method;
    registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel, payloadMode: 'tuple', rolloutRound: 35,
      sourceFile: 'desktop/electron/plugin-action-typed-ipc.ts', riskTags: [...PLUGIN_ACTION_RISKS[method]],
      input: z.custom<unknown[]>(() => true).transform(raw => capturePluginActionInput(method, raw)), output: PLUGIN_ACTION_OUTPUTS[method],
      handler: async (args, event) => {
        try {
          if (method !== 'openPluginDependencyPermissionSettings' || process.platform === 'darwin') {
            assertStandardIpcPromise(environmentWitness, 'plugin_action_projection_unavailable');
          }
          const producer = bindings.get(channel); if (!producer) throw Error('plugin_action_runtime_unavailable');
          const result = producer(event, ...args);
          assertStandardIpcPromise(result, 'plugin_action_projection_unavailable');
          return await new NativePromise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
            try { resolve(capturePluginActionOutput(method, value)); } catch (error) { reject(error); }
          }, reject]));
        } catch (error) { throw Error(pluginActionCode(error)); }
      },
    });
  }
  owners.set(ipc, producers);
}
