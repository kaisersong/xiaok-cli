import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import { GOAL_NATIVE_QUERY_CHANNEL, GOAL_NATIVE_QUERY_OUTPUT, type GoalNativeQueryDto } from '../shared/goal-native-query-ipc-contract.js';

const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const witness = new NativePromise<void>(resolve => resolve());

/** Exact original IPC query. No native mutation, recovery, owner issuance or new port. */
export function registerGoalNativeQueryIpc(
  ipc: IpcHandleRegistrar,
  read: (threadId: string) => Promise<GoalNativeQueryDto | null>,
  parseOriginalInput: (input: unknown) => { threadId: string },
  authorize: (event: IpcMainInvokeEvent) => void,
): void {
  const captureOutput = (raw: GoalNativeQueryDto | null): GoalNativeQueryDto | null => {
    const snapshot = captureIpcData(raw, 'goal_native_query_projection_unavailable');
    if (!GOAL_NATIVE_QUERY_OUTPUT.safeParse(snapshot).success) throw Error('goal_native_query_projection_unavailable');
    return snapshot;
  };
  registerIpcHandler<[{ threadId: string }], GoalNativeQueryDto | null>({
    registrar: ipc, channel: GOAL_NATIVE_QUERY_CHANNEL, payloadMode: 'tuple',
    sourceFile: 'desktop/electron/goal-native-query-typed-ipc.ts', rolloutRound: 37,
    riskTags: ['fs-read'], output: GOAL_NATIVE_QUERY_OUTPUT,
    beforeInput: event => { authorize(event); return undefined; },
    beforeOutput: event => { authorize(event); return undefined; },
    input: z.custom<[{ threadId: string }]>(() => true).transform(raw => {
      const snapshot = captureIpcData(raw, 'goal_native_query_input_invalid');
      if (!Array.isArray(snapshot) || snapshot.length !== 1 || !Object.hasOwn(snapshot, '0')) throw Error('goal_native_query_input_invalid');
      // Keep the real publication parser and its domain errors/trim; never read raw input.
      return [{ threadId: parseOriginalInput(snapshot[0]).threadId }];
    }),
    handler: (args) => {
      // Preflight BEFORE entering the real synchronous Services delegator and async coordinator.
      assertStandardIpcPromise(witness, 'goal_native_query_projection_unavailable');
      const raw = read(args[0].threadId);
      assertStandardIpcPromise(raw, 'goal_native_query_projection_unavailable');
      return new NativePromise<GoalNativeQueryDto | null>((resolve, reject) => apply(nativeThen, raw, [(value: GoalNativeQueryDto | null) => {
        try { resolve(captureOutput(value)); } catch (error) { reject(error); }
      }, reject]));
    },
    captureOutput,
  });
}
