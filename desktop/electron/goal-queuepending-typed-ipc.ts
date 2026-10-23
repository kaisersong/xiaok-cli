// Typed whole-boolean Goal queue transport; original service/coordinator purposes unchanged.
import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { createDesktopServices } from './desktop-services.js';
type DesktopServices = ReturnType<typeof createDesktopServices>;
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';

export const GOAL_QUEUE_PENDING_CHANNEL = 'desktop:goal:setUserQueuePending';
export const GOAL_QUEUE_PENDING_OUTPUT = z.undefined();
export type GoalQueuePendingInput = { threadId: string; pending: boolean };
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const witness = new NativePromise<void>(resolve => resolve());
const outputError = 'goal_queue_projection_unavailable';

/** Complete original boolean channel; no new native authority, business owner or queue. */
export function registerGoalQueuePendingIpc(
  ipc: IpcHandleRegistrar,
  services: Pick<DesktopServices, 'setGoalUserQueuePending'>,
  parseGoalThreadId: (value: unknown) => string,
  authorize: (event: IpcMainInvokeEvent) => void,
): void {
  const producer = (input: GoalQueuePendingInput): Promise<void> => {
    return services.setGoalUserQueuePending({
      threadId: parseGoalThreadId(input.threadId), pending: input.pending,
    });
  };
  const captureVoid = (value: unknown): undefined => {
    const snapshot = captureIpcData(value, outputError);
    if (!GOAL_QUEUE_PENDING_OUTPUT.safeParse(snapshot).success) throw Error(outputError);
    return undefined;
  };
  registerIpcHandler<[GoalQueuePendingInput], void>({
    registrar: ipc, channel: GOAL_QUEUE_PENDING_CHANNEL, payloadMode: 'tuple',
    sourceFile: 'desktop/electron/goal-queuepending-typed-ipc.ts', rolloutRound: 37,
    riskTags: ['internal-mutation'], output: GOAL_QUEUE_PENDING_OUTPUT,
    beforeInput: event => { authorize(event); return undefined; },
    beforeOutput: event => { authorize(event); return undefined; },
    input: z.custom<[GoalQueuePendingInput]>(() => true).transform((raw): [GoalQueuePendingInput] => {
      const snapshot = captureIpcData(raw, 'invalid_goal_queue_state');
      if (!Array.isArray(snapshot) || snapshot.length !== 1 || !Object.hasOwn(snapshot, '0')) throw Error('invalid_goal_queue_state');
      const input: unknown = snapshot[0];
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalid_goal_queue_state');
      const data = input as Record<string, unknown>;
      if (typeof data.pending !== 'boolean') throw Error('invalid_goal_queue_state');
      // Keep original trim/domain error; extra own data fields stay ignored, never authority.
      return [{ threadId: parseGoalThreadId(data.threadId), pending: data.pending }];
    }),
    handler: args => {
      // Witness BEFORE the original delegator/coordinator can create a Promise or effect.
      assertStandardIpcPromise(witness, outputError);
      const raw = producer(args[0]);
      assertStandardIpcPromise(raw, outputError);
      return new NativePromise<void>((resolve, reject) => apply(nativeThen, raw, [
        (value: unknown) => { try { captureVoid(value); resolve(); } catch (error) { reject(error); } }, reject,
      ]));
    },
    captureOutput: captureVoid,
  });
}
