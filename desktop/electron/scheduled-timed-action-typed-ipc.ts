import { types } from 'node:util';
import { z } from 'zod';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { SCHEDULED_INPUT_SCHEMAS, SCHEDULED_OUTPUT_SCHEMAS, type ScheduledIpcMethod } from '../shared/scheduled-timed-action-ipc-contract.js';

const methods = Object.keys(SCHEDULED_INPUT_SCHEMAS) as ScheduledIpcMethod[];
const isPromise = types.isPromise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const effects: RiskTag[] = ['fs-read', 'fs-write', 'fs-delete', 'fs-write-userData', 'internal-mutation', 'network', 'exec', 'external-process'];
const readers = new Set<ScheduledIpcMethod>(['syncScheduledTasks','getScheduledTasks','loops:getScheduleBindings','getTimedActions','getTimedActionRuns','listReminders','getReminderStatus']);
export function captureScheduledOutput(method: ScheduledIpcMethod, raw: unknown): unknown {
  const error = readers.has(method) ? 'scheduled_projection_unavailable' : 'scheduled_operation_unknown';
  const snapshot = captureIpcData(raw, error);
  if (!SCHEDULED_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error(error);
  return snapshot;
}
type Producers = ReadonlyMap<string, IpcHandlerListener>;
const owners = new WeakMap<IpcHandleRegistrar, { producers: Producers | null; installed: Set<ScheduledIpcMethod>; registrar: IpcHandleRegistrar }>();

/** Fixed semantic channels; producers are private Main callbacks, never renderer input. */
export function registerScheduledTimedActionIpc(ipc: IpcHandleRegistrar, rawProducers?: Producers): void {
  const producers = rawProducers ?? null;
  let owner = owners.get(ipc);
  if (owner && owner.producers !== producers) throw Error('scheduled_registrar_owner_conflict');
  if (!owner) {
    const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
      return ipc.handle(channel, (event, ...args) => {
        if (!producers?.has(channel)) throw Error('scheduled_runtime_unavailable');
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
        const snapshot = captureIpcData(raw, 'scheduled_input_invalid');
        if (!SCHEDULED_INPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('scheduled_input_invalid');
        return snapshot;
      }), output: SCHEDULED_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 22,
      sourceFile: 'desktop/electron/scheduled-timed-action-typed-ipc.ts',
      // Mutations retain the original single Main scheduler and its executors.
      riskTags: readers.has(method) ? ['fs-read'] : [...effects],
      handler: async (args, event) => {
        const producer = producers?.get(channel);
        if (!producer) throw Error('scheduled_runtime_unavailable');
        const result = producer(event, ...args);
        if (!isPromise(result)) return captureScheduledOutput(method, result);
        const error = readers.has(method) ? 'scheduled_projection_unavailable' : 'scheduled_operation_unknown';
        assertStandardIpcPromise(result, error);
        return new Promise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
          try { resolve(captureScheduledOutput(method, value)); } catch (failure) { reject(failure); }
        }, reject]));
      },
    });
    owner.installed.add(method);
  }
}
