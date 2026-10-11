import { types } from 'node:util';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { AUTOMATION_CONFIG_INPUT_SCHEMAS, AUTOMATION_CONFIG_OUTPUT_SCHEMAS, type AutomationConfigMethod } from '../shared/automation-config-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply, isPromise = types.isPromise;
const owners = new WeakMap<IpcHandleRegistrar, ReadonlyMap<string, IpcHandlerListener> | null>();
export function registerAutomationConfigIpc(ipc: IpcHandleRegistrar, rawProducers?: ReadonlyMap<string, IpcHandlerListener>): void {
  const producers = rawProducers ?? null;
  if (owners.has(ipc)) { if (owners.get(ipc) !== producers) throw Error('automation_config_registrar_owner_conflict'); return; }
  for (const method of Object.keys(AUTOMATION_CONFIG_INPUT_SCHEMAS) as AutomationConfigMethod[]) {
    const captureOutput = (value: unknown) => {
      const snapshot = captureIpcData(value, 'automation_config_operation_unknown');
      if (!AUTOMATION_CONFIG_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('automation_config_operation_unknown');
      return snapshot;
    };
    const channel = `desktop:automations:${method}`;
    registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel,
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const snapshot = captureIpcData(raw, 'automation_config_input_invalid');
        if (!AUTOMATION_CONFIG_INPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('automation_config_input_invalid');
        return snapshot;
      }), output: AUTOMATION_CONFIG_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 30,
      sourceFile: 'desktop/electron/automation-config-typed-ipc.ts', riskTags: method === 'setGlobalBackgroundAutoRun' ? ['fs-write-userData', 'internal-mutation'] : ['fs-read'],
      handler: async (args, event) => {
        const producer = producers?.get(channel);
        if (!producer) throw Error('automation_config_runtime_unavailable');
        try {
          const result = producer(event, ...args);
          if (!isPromise(result)) return captureOutput(result);
          assertStandardIpcPromise(result, 'automation_config_operation_unknown');
          return new NativePromise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
            try { resolve(captureOutput(value)); } catch { reject(Error('automation_config_operation_unknown')); }
          }, () => reject(Error('automation_config_operation_unknown'))]));
        } catch { throw Error('automation_config_operation_unknown'); }
      },
    });
  }
  owners.set(ipc, producers);
}
