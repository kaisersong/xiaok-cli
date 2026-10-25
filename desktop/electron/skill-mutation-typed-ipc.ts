import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { SKILL_MUTATION_INPUT_SCHEMA, SKILL_MUTATION_OUTPUT_SCHEMA } from '../shared/skill-mutation-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
type Producers = ReadonlyMap<string, IpcHandlerListener>;
const owners = new WeakMap<IpcHandleRegistrar, Producers | null>();
export function registerSkillMutationIpc(ipc: IpcHandleRegistrar, rawProducers?: Producers): void {
  const producers = rawProducers ?? null;
  if (owners.has(ipc)) { if (owners.get(ipc) !== producers) throw Error('skill_mutation_registrar_owner_conflict'); return; }
  for (const channel of ['desktop:installSkill', 'desktop:uninstallSkill']) {
    registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel,
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const snapshot = captureIpcData(raw, 'skill_mutation_input_invalid');
        if (!SKILL_MUTATION_INPUT_SCHEMA.safeParse(snapshot).success) throw Error('skill_mutation_input_invalid');
        return snapshot;
      }), output: SKILL_MUTATION_OUTPUT_SCHEMA, payloadMode: 'tuple', rolloutRound: 34,
      riskTags: channel === 'desktop:installSkill' ? ['external-process', 'network', 'fs-write'] : ['external-process', 'fs-delete'],
      sourceFile: 'desktop/electron/skill-mutation-typed-ipc.ts',
      handler: async (args, event) => {
        const producer = producers?.get(channel);
        if (!producer) throw Error('skill_mutation_runtime_unavailable');
        const result = producer(event, ...args);
        assertStandardIpcPromise(result, 'skill_mutation_output_invalid');
        return new NativePromise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
          try {
            const snapshot = captureIpcData(value, 'skill_mutation_output_invalid');
            if (!SKILL_MUTATION_OUTPUT_SCHEMA.safeParse(snapshot).success) throw Error('skill_mutation_output_invalid');
            resolve(snapshot);
          } catch (error) { reject(error); }
        }, reject]));
      },
    });
  }
  owners.set(ipc, producers);
}
