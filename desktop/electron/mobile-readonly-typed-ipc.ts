import { types } from 'node:util';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { MOBILE_READONLY_INPUT_SCHEMAS, MOBILE_READONLY_OUTPUT_SCHEMAS, type MobileReadonlyMethod, type MobileRelayStatusDto } from '../shared/mobile-readonly-ipc-contract.js';

type Producers = ReadonlyMap<string, IpcHandlerListener>;
const methods = Object.keys(MOBILE_READONLY_INPUT_SCHEMAS) as MobileReadonlyMethod[];
const isPromise = types.isPromise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const owners = new WeakMap<IpcHandleRegistrar, { producers: Producers | null; installed: Set<MobileReadonlyMethod> }>();
function captureOutput(method: MobileReadonlyMethod, raw: unknown): unknown {
  const snapshot = captureIpcData(raw, 'mobile_projection_unavailable');
  if (!MOBILE_READONLY_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('mobile_projection_unavailable');
  return snapshot;
}
export function captureMobileRelayStatus(raw: unknown): MobileRelayStatusDto {
  return captureOutput('getRelayStatus', raw) as MobileRelayStatusDto;
}
/** Authority is supplied by Main's sole shutdown-aware owner before any input or producer read. */
export function registerMobileReadonlyIpc(ipc: IpcHandleRegistrar, rawProducers?: Producers): void {
  const producers = rawProducers ?? null;
  let owner = owners.get(ipc);
  if (owner && owner.producers !== producers) throw Error('mobile_registrar_owner_conflict');
  if (!owner) { owner = { producers, installed: new Set() }; owners.set(ipc, owner); }
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const channel = `desktop:mobile:${method}`;
    registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel,
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const snapshot = captureIpcData(raw, 'mobile_input_invalid');
        if (!MOBILE_READONLY_INPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('mobile_input_invalid');
        return snapshot;
      }), output: MOBILE_READONLY_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 27,
      sourceFile: 'desktop/electron/mobile-readonly-typed-ipc.ts', riskTags: ['capability-token'],
      handler: async (args, event) => {
        const producer = producers?.get(channel);
        if (!producer) throw Error('mobile_runtime_unavailable');
        const result = producer(event, ...args);
        if (!isPromise(result)) return captureOutput(method, result);
        assertStandardIpcPromise(result, 'mobile_projection_unavailable');
        return new Promise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
          try { resolve(captureOutput(method, value)); } catch (error) { reject(error); }
        }, reject]));
      },
    });
    owner.installed.add(method);
  }
}
