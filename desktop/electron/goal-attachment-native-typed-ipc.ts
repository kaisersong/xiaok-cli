import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { registerIpcHandler } from './ipc-runtime.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { GOAL_ATTACHMENT_NATIVE_METHODS, GOAL_ATTACHMENT_NATIVE_OUTPUTS, type GoalAttachmentNativeMethod } from '../shared/goal-attachment-native-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const witness = new NativePromise<void>(resolve => resolve());

/** Only four original registrations. Each original full listener/parser/delegation remains unchanged.
 * Wire snapshot is typed [unknown]; the unchanged original listener validates its semantic payload
 * with original domain errors BEFORE its actual Services call. Do not claim zod validates those domains.
 */
export function createGoalAttachmentNativeTransportIpc(
  ipc: IpcHandleRegistrar,
  authorize: (event: IpcMainInvokeEvent) => void,
): IpcHandleRegistrar {
  return {
    handle(channel: string, listener: IpcHandlerListener): void {
      const method = GOAL_ATTACHMENT_NATIVE_METHODS.find(name => channel === 'desktop:goal:' + name);
      if (!method) throw Error('goal_attachment_native_unowned_channel');
      register(method, channel, listener);
    },
  };
  function register(method: GoalAttachmentNativeMethod, channel: string, listener: IpcHandlerListener): void {
    const output = GOAL_ATTACHMENT_NATIVE_OUTPUTS[method];
    const captureOutput = (raw: unknown): unknown => {
      const snapshot = captureIpcData(raw, 'goal_attachment_native_projection_unavailable');
      if (!output.safeParse(snapshot).success) throw Error('goal_attachment_native_projection_unavailable');
      return snapshot;
    };
    registerIpcHandler<[unknown], unknown>({
      registrar: ipc, channel, payloadMode: 'tuple',
      sourceFile: 'desktop/electron/goal-attachment-native-typed-ipc.ts', rolloutRound: 37,
      riskTags: method === 'ackTaskAttached'
        ? ['fs-write', 'internal-mutation', 'external-process']
        : ['fs-read', 'fs-write', 'internal-mutation', 'external-process'],
      input: z.custom<[unknown]>(() => true).transform((raw): [unknown] => {
        const snapshot = captureIpcData(raw, 'goal_attachment_native_input_invalid');
        if (!Array.isArray(snapshot) || snapshot.length !== 1 || !Object.hasOwn(snapshot, '0'))
          throw Error('goal_attachment_native_input_invalid');
        return [snapshot[0]];
      }),
      output,
      beforeInput: event => { authorize(event); return undefined; },
      beforeOutput: event => { authorize(event); return undefined; },
      handler: (args, event) => {
        assertStandardIpcPromise(witness, 'goal_attachment_native_projection_unavailable');
        const raw: unknown = apply(listener, undefined, [event, ...args]);
        assertStandardIpcPromise(raw, 'goal_attachment_native_projection_unavailable');
        return new NativePromise<unknown>((resolve, reject) => apply(nativeThen, raw, [
          (value: unknown) => { try { resolve(captureOutput(value)); } catch (error) { reject(error); } }, reject,
        ]));
      },
      captureOutput,
    });
  }
}

