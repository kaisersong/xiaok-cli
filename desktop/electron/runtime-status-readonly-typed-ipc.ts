import { types } from 'node:util';
import { z, type ZodType } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { COMPUTER_USE_STATUS_SCHEMA, KSWARM_STATUS_SCHEMA, RUNTIME_STATUS_INPUT_SCHEMA } from '../shared/runtime-status-readonly-ipc-contract.js';
const isPromise = types.isPromise, NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const capabilityOwners = new WeakMap<IpcHandleRegistrar, IpcHandlerListener | undefined>();
const sdkOwners = new WeakMap<IpcHandleRegistrar, IpcHandlerListener | undefined>();
function registerStatus(ipc: IpcHandleRegistrar, channel: string, output: ZodType, owners: WeakMap<IpcHandleRegistrar, IpcHandlerListener | undefined>, producer?: IpcHandlerListener) {
  if (owners.has(ipc)) { if (owners.get(ipc) !== producer) throw Error('runtime_status_registrar_owner_conflict'); return; }
  const capture = (raw: unknown) => {
    const value = captureIpcData(raw, 'runtime_status_projection_unavailable');
    if (!output.safeParse(value).success) throw Error('runtime_status_projection_unavailable');
    return value;
  };
  registerIpcHandler<unknown[], unknown>({
    registrar: ipc, channel, output, payloadMode: 'tuple', rolloutRound: 34, riskTags: [], sourceFile: 'desktop/electron/runtime-status-readonly-typed-ipc.ts',
    input: z.custom<unknown[]>(() => true).transform(raw => {
      const value = captureIpcData(raw, 'runtime_status_input_invalid');
      if (!RUNTIME_STATUS_INPUT_SCHEMA.safeParse(value).success) throw Error('runtime_status_input_invalid');
      return value;
    }),
    handler: async (args, event) => {
      if (!producer) throw Error('runtime_status_runtime_unavailable');
      const result = producer(event, ...args);
      if (!isPromise(result)) return capture(result);
      assertStandardIpcPromise(result, 'runtime_status_projection_unavailable');
      return new NativePromise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => { try { resolve(capture(value)); } catch (error) { reject(error); } }, reject]));
    },
  });
  owners.set(ipc, producer);
}
export function registerComputerUseCapabilityReadonlyIpc(ipc: IpcHandleRegistrar, producer?: IpcHandlerListener) { registerStatus(ipc, 'desktop:getComputerUseCapabilityStatus', COMPUTER_USE_STATUS_SCHEMA, capabilityOwners, producer); }
export function registerKswarmStatusReadonlyIpc(ipc: IpcHandleRegistrar, producer?: IpcHandlerListener) { registerStatus(ipc, 'desktop:kswarm:getStatus', KSWARM_STATUS_SCHEMA, sdkOwners, producer); }
