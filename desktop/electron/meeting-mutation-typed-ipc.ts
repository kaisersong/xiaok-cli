import { types } from 'node:util';
import { z } from 'zod';
import { registerIpcHandler } from './ipc-runtime.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { meetingMutationError } from './meeting-mutation-service.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { MEETING_MUTATION_METHODS, MEETING_MUTATION_INPUT_SCHEMAS, MEETING_MUTATION_OUTPUT_SCHEMAS } from '../shared/meeting-mutation-ipc-contract.js';
const nativeThen = Promise.prototype.then;
const owners = new WeakMap<IpcHandleRegistrar, ReadonlyMap<string, IpcHandlerListener>>();
export function registerMeetingMutationIpc(ipc: IpcHandleRegistrar, producers: ReadonlyMap<string, IpcHandlerListener>): void {
  if (owners.has(ipc)) { if (owners.get(ipc) !== producers) throw Error('meeting_mutation_registrar_owner_conflict'); return; }
  // Detach producer bindings once; do not trust subsequent Map mutation.
  const bindings = new Map(producers);
  for (const method of MEETING_MUTATION_METHODS) {
    const channel = 'desktop:meeting:' + method, output = MEETING_MUTATION_OUTPUT_SCHEMAS[method];
    const capture = (raw: unknown) => {
      const value = captureIpcData(raw, 'meeting_mutation_projection_unavailable');
      if (!output.safeParse(value).success) throw Error('meeting_mutation_projection_unavailable');
      return value;
    };
    registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel,
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const value = captureIpcData(raw, 'meeting_mutation_input_invalid');
        if (!MEETING_MUTATION_INPUT_SCHEMAS[method].safeParse(value).success) throw Error('meeting_mutation_input_invalid');
        return value;
      }), output, payloadMode: 'tuple', rolloutRound: 34,
      riskTags: method === 'requestMicrophonePermission' ? ['dialog'] : method === 'saveAsrConfig' ? ['fs-write'] : method === 'downloadModel' ? ['network', 'fs-write'] : ['fs-delete'],
      sourceFile: 'desktop/electron/meeting-mutation-typed-ipc.ts',
      handler: async (args, event) => {
        const producer = bindings.get(channel); if (!producer) throw Error('meeting_mutation_runtime_unavailable');
        try {
          const result = producer(event, ...args);
          if (!types.isPromise(result)) return capture(result);
          assertStandardIpcPromise(result, 'meeting_mutation_projection_unavailable');
          return await new Promise((resolve, reject) => Reflect.apply(nativeThen, result, [(value: unknown) => { try { resolve(capture(value)); } catch (error) { reject(error); } }, reject]));
        } catch (error) { throw meetingMutationError(error); }
      },
    });
  }
  owners.set(ipc, producers);
}
