import { types } from 'node:util';
import { z } from 'zod';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { CONNECTORS_INPUT_SCHEMAS, CONNECTORS_OUTPUT_SCHEMAS, type ConnectorsIpcMethod } from '../shared/connectors-ipc-contract.js';

const methods = Object.keys(CONNECTORS_INPUT_SCHEMAS) as ConnectorsIpcMethod[];
const isPromise = types.isPromise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const effects: RiskTag[] = ['fs-read', 'fs-write', 'fs-write-userData', 'internal-mutation'];
const readers = new Set<ConnectorsIpcMethod>(['getConnectorsConfig','listConnectorRuntimes']);
export function captureConnectorsOutput(method: ConnectorsIpcMethod, raw: unknown): unknown {
  const error = readers.has(method) ? 'connectors_projection_unavailable' : 'connectors_operation_unknown';
  const snapshot = captureIpcData(raw, error);
  if (!CONNECTORS_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error(error);
  return snapshot;
}
type Producers = ReadonlyMap<string, IpcHandlerListener>;
const owners = new WeakMap<IpcHandleRegistrar, { producers: Producers | null; installed: Set<ConnectorsIpcMethod>; registrar: IpcHandleRegistrar }>();

/** Fixed semantic channels; producers are private Main callbacks, never renderer input. */
export function registerConnectorsIpc(ipc: IpcHandleRegistrar, rawProducers?: Producers): void {
  const producers = rawProducers ?? null;
  let owner = owners.get(ipc);
  if (owner && owner.producers !== producers) throw Error('connectors_registrar_owner_conflict');
  if (!owner) {
    const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
      return ipc.handle(channel, (event, ...args) => {
        if (!producers?.has(channel)) throw Error('connectors_runtime_unavailable');
        return listener(event, ...args);
      });
    } });
    owner = { producers, installed: new Set(), registrar }; owners.set(ipc, owner);
  }
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const channel = `desktop:${method}`;
    registerIpcHandler<unknown[], unknown>({ registrar: owner.registrar, channel,
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const snapshot = captureIpcData(raw, 'connectors_input_invalid');
        if (!CONNECTORS_INPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('connectors_input_invalid');
        return snapshot;
      }), output: CONNECTORS_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 23,
      sourceFile: 'desktop/electron/connectors-typed-ipc.ts',
      // Configuration remains Main-owned; the settings probe uses the original HTTP provider.
      riskTags: readers.has(method) ? ['fs-read'] : method === 'testConnectorProvider' ? ['network'] : [...effects],
      handler: async (args, event) => {
        const producer = producers?.get(channel);
        if (!producer) throw Error('connectors_runtime_unavailable');
        const result = producer(event, ...args);
        if (!isPromise(result)) return captureConnectorsOutput(method, result);
        const error = readers.has(method) ? 'connectors_projection_unavailable' : 'connectors_operation_unknown';
        assertStandardIpcPromise(result, error);
        return new Promise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
          try { resolve(captureConnectorsOutput(method, value)); } catch (failure) { reject(failure); }
        }, reject]));
      },
    });
    owner.installed.add(method);
  }
}
