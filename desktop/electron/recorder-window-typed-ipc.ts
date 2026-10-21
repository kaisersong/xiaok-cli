import { types } from 'node:util';
import { z } from 'zod';
import type { IpcMainInvokeEvent } from 'electron';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { RECORDER_WINDOW_INPUT_SCHEMAS, RECORDER_WINDOW_OUTPUT_SCHEMAS, type RecorderWindowIpcMethod } from '../shared/recorder-window-ipc-contract.js';

const methods = Object.keys(RECORDER_WINDOW_INPUT_SCHEMAS) as RecorderWindowIpcMethod[];
const isPromise = types.isPromise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
type Producers = ReadonlyMap<string, IpcHandlerListener>;
interface MainSenderAuthority {
  isMainWindowSender(sender: IpcMainInvokeEvent['sender']): boolean;
  isRecorderWindowSender(sender: IpcMainInvokeEvent['sender']): boolean;
}
const owners = new WeakMap<IpcHandleRegistrar, { producers: Producers; authority: MainSenderAuthority; installed: Set<RecorderWindowIpcMethod>; registrar: IpcHandleRegistrar }>();
const requiredError = (method: RecorderWindowIpcMethod): string => method === 'meetingSetRecorderWindowMode' ? 'invalid_mode' : method === 'meetingSetRecorderSessionState' ? 'invalid_state' : 'collection_id_required';
function parseInput(method: RecorderWindowIpcMethod, raw: unknown[]): unknown[] {
  const snapshot = captureIpcData(raw, 'recorder_input_invalid');
  const expected = method === 'meetingCloseRecorderWindow' ? 0 : 1;
  if (snapshot.length > expected || (expected === 0 && snapshot.length !== 0)) throw Error('recorder_input_invalid');
  let normalized = snapshot;
  if (method === 'meetingNotifyRecorderSummaryReady') {
    const input = snapshot[0];
    const title = input !== null && typeof input === 'object' && Object.hasOwn(input, 'title')
      ? (input as Record<string, unknown>).title : undefined;
    normalized = [{ title: typeof title === 'string' ? title : '' }];
  }
  if (!RECORDER_WINDOW_INPUT_SCHEMAS[method].safeParse(normalized).success) throw Error(requiredError(method));
  return normalized;
}
function captureOutput(method: RecorderWindowIpcMethod, raw: unknown): unknown {
  const snapshot = captureIpcData(raw, 'recorder_operation_unknown');
  if (!RECORDER_WINDOW_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('recorder_operation_unknown');
  return snapshot;
}
/** Both sender predicates and producers are private Main closures, never wire grants. */
export function registerRecorderWindowIpc(ipc: IpcHandleRegistrar, producers: Producers, authority: MainSenderAuthority): void {
  let owner = owners.get(ipc);
  if (owner && (owner.producers !== producers || owner.authority !== authority)) throw Error('recorder_registrar_owner_conflict');
  if (!owner) {
    const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
      return ipc.handle(channel, (event, ...args) => {
        // Identity admission precedes every payload inspection, including capture/schema.
        const allowed = channel === 'desktop:meetingOpenRecorderWindow'
          ? authority.isMainWindowSender(event.sender) : authority.isRecorderWindowSender(event.sender);
        if (!allowed) return { ok: false, error: 'unauthorized_sender' };
        if (!producers.has(channel)) throw Error('recorder_runtime_unavailable');
        return listener(event, ...args);
      });
    } });
    owner = { producers, authority, installed: new Set(), registrar }; owners.set(ipc, owner);
  }
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const channel = `desktop:${method}`;
    registerIpcHandler<unknown[], unknown>({ registrar: owner.registrar, channel,
      input: z.custom<unknown[]>(() => true).transform(raw => parseInput(method, raw)),
      inputError: error => ({ ok: false, error: error instanceof Error && ['invalid_mode', 'invalid_state', 'collection_id_required'].includes(error.message) ? error.message : 'recorder_input_invalid' }),
      output: RECORDER_WINDOW_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 24,
      sourceFile: 'desktop/electron/recorder-window-typed-ipc.ts', riskTags: ['internal-mutation'],
      handler: async (args, event) => {
        const producer = producers.get(channel);
        if (!producer) throw Error('recorder_runtime_unavailable');
        const result = producer(event, ...args);
        if (!isPromise(result)) return captureOutput(method, result);
        assertStandardIpcPromise(result, 'recorder_operation_unknown');
        return new Promise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
          try { resolve(captureOutput(method, value)); } catch (failure) { reject(failure); }
        }, reject]));
      },
    });
    owner.installed.add(method);
  }
}
