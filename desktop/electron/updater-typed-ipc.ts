import { types } from 'node:util';
import { z } from 'zod';
import type { IpcMainInvokeEvent } from 'electron';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { UPDATER_INPUT_SCHEMAS, UPDATER_OUTPUT_SCHEMAS, type UpdaterIpcMethod } from '../shared/updater-ipc-contract.js';
const methods = Object.keys(UPDATER_INPUT_SCHEMAS) as UpdaterIpcMethod[];
const nativeThen = Promise.prototype.then, apply = Reflect.apply, isPromise = types.isPromise;
type Producers = ReadonlyMap<string, IpcHandlerListener>;
type Authority = (sender: IpcMainInvokeEvent['sender']) => boolean;
const owners = new WeakMap<IpcHandleRegistrar, { producers: Producers; authority: Authority; installed: Set<UpdaterIpcMethod>; registrar: IpcHandleRegistrar }>();
function captureOutput(method: UpdaterIpcMethod, raw: unknown): unknown {
  const code = method === 'getUpdateStatus' ? 'updater_projection_unavailable' : 'updater_operation_unknown';
  const value = captureIpcData(raw, code);
  if (!UPDATER_OUTPUT_SCHEMAS[method].safeParse(value).success) throw Error(code);
  return value;
}
export function registerUpdaterIpc(ipc: IpcHandleRegistrar, producers: Producers, authority: Authority): void {
  let owner = owners.get(ipc);
  if (owner && (owner.producers !== producers || owner.authority !== authority)) throw Error('updater_registrar_owner_conflict');
  if (!owner) {
    const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
      return ipc.handle(channel, (event, ...args) => {
        if (authority(event.sender) !== true) throw Error('updater_request_source_forbidden');
        if (!producers.has(channel)) throw Error('updater_runtime_unavailable');
        return listener(event, ...args);
      });
    } });
    owner = { producers, authority, installed: new Set(), registrar }; owners.set(ipc, owner);
  }
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const channel = `desktop:${method}`;
    registerIpcHandler<unknown[], unknown>({ registrar: owner.registrar, channel,
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const value = captureIpcData(raw, 'updater_input_invalid');
        if (!UPDATER_INPUT_SCHEMAS[method].safeParse(value).success) throw Error('updater_input_invalid');
        return value;
      }), output: UPDATER_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 25,
      sourceFile: 'desktop/electron/updater-typed-ipc.ts', riskTags: method === 'getUpdateStatus' ? ['fs-read'] : method === 'checkForUpdates' ? ['network', 'internal-mutation'] : ['internal-mutation'],
      handler: async (args, event) => {
        const producer = producers.get(channel);
        if (!producer) throw Error('updater_runtime_unavailable');
        const result = producer(event, ...args);
        if (!isPromise(result)) return captureOutput(method, result);
        assertStandardIpcPromise(result, method === 'getUpdateStatus' ? 'updater_projection_unavailable' : 'updater_operation_unknown');
        return new Promise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
          try { resolve(captureOutput(method, value)); } catch (error) { reject(error); }
        }, reject]));
      },
    });
    owner.installed.add(method);
  }
}
