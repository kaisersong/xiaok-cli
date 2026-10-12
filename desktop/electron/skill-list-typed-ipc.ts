import { types } from 'node:util';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { SKILL_LIST_INPUT_SCHEMA, SKILL_LIST_OUTPUT_SCHEMA } from '../shared/skill-list-ipc-contract.js';
const isPromise = types.isPromise, nativeThen = Promise.prototype.then, apply = Reflect.apply, NativePromise = Promise;
const owners = new WeakMap<IpcHandleRegistrar, ReadonlyMap<string, IpcHandlerListener> | null>();
export function registerSkillListIpc(ipc: IpcHandleRegistrar, rawProducers?: ReadonlyMap<string, IpcHandlerListener>): void {
  const producers = rawProducers ?? null;
  if (owners.has(ipc)) { if (owners.get(ipc) !== producers) throw Error('skill_list_registrar_owner_conflict'); return; }
  const capture = (raw: unknown) => {
    const snapshot = captureIpcData(raw, 'skill_list_projection_unavailable');
    if (!SKILL_LIST_OUTPUT_SCHEMA.safeParse(snapshot).success) throw Error('skill_list_projection_unavailable');
    return snapshot;
  };
  registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel: 'desktop:listSkills',
    input: z.custom<unknown[]>(() => true).transform(raw => {
      const snapshot = captureIpcData(raw, 'skill_list_input_invalid');
      if (!SKILL_LIST_INPUT_SCHEMA.safeParse(snapshot).success) throw Error('skill_list_input_invalid');
      return snapshot;
    }), output: SKILL_LIST_OUTPUT_SCHEMA, payloadMode: 'tuple', rolloutRound: 31,
    riskTags: ['fs-read'], sourceFile: 'desktop/electron/skill-list-typed-ipc.ts',
    handler: async (args, event) => {
      const producer = producers?.get('desktop:listSkills');
      if (!producer) throw Error('skill_list_runtime_unavailable');
      const result = producer(event, ...args);
      if (!isPromise(result)) return capture(result);
      assertStandardIpcPromise(result, 'skill_list_projection_unavailable');
      return new NativePromise((resolve, reject) => apply(nativeThen, result, [
        (value: unknown) => { try { resolve(capture(value)); } catch (error) { reject(error); } }, reject,
      ]));
    },
  });
  owners.set(ipc, producers);
}
