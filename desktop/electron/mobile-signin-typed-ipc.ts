import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { MOBILE_SIGNIN_INPUT_SCHEMA, MOBILE_SIGNIN_OUTPUT_SCHEMA } from '../shared/mobile-signin-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const channel = 'desktop:mobile:openRelaySignIn';
type Producers = ReadonlyMap<string, IpcHandlerListener>;
const owners = new WeakMap<IpcHandleRegistrar, Producers | null>();
export function registerMobileSignInIpc(ipc: IpcHandleRegistrar, rawProducers?: Producers): void {
  const producers = rawProducers ?? null;
  if (owners.has(ipc)) { if (owners.get(ipc) !== producers) throw Error('mobile_signin_registrar_owner_conflict'); return; }
  registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel,
    input: z.custom<unknown[]>(() => true).transform(raw => {
      const snapshot = captureIpcData(raw, 'mobile_signin_input_invalid');
      if (!MOBILE_SIGNIN_INPUT_SCHEMA.safeParse(snapshot).success) throw Error('mobile_signin_input_invalid');
      return snapshot;
    }), output: MOBILE_SIGNIN_OUTPUT_SCHEMA, payloadMode: 'tuple', rolloutRound: 29,
    riskTags: ['shell-open'], sourceFile: 'desktop/electron/mobile-signin-typed-ipc.ts',
    handler: async (args, event) => {
      const producer = producers?.get(channel);
      if (!producer) throw Error('mobile_signin_runtime_unavailable');
      const result = producer(event, ...args);
      assertStandardIpcPromise(result, 'mobile_signin_operation_unknown');
      return new NativePromise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
        try {
          const snapshot = captureIpcData(value, 'mobile_signin_operation_unknown');
          if (!MOBILE_SIGNIN_OUTPUT_SCHEMA.safeParse(snapshot).success) throw Error('mobile_signin_operation_unknown');
          resolve(snapshot);
        } catch (error) { reject(error); }
      }, reject]));
    },
  });
  owners.set(ipc, producers);
}
