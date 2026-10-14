import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import { GOAL_GET_CHANNEL, GOAL_GET_OUTPUT, type GoalGetDto } from '../shared/goal-get-ipc-contract.js';

const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const witness = new NativePromise<void>(resolve => resolve());

/** Transport only. The original entire Services/coordinator/observer body remains unchanged. */
export function registerGoalGetIpc(
  ipc: IpcHandleRegistrar,
  read: (threadId: string) => Promise<GoalGetDto | null>,
  parseOriginalThreadId: (value: unknown) => string,
  authorize: (event: IpcMainInvokeEvent) => void,
): void {
  const captureOutput = (raw: GoalGetDto | null): GoalGetDto | null => {
    const data = captureIpcData(raw, 'goal_get_projection_unavailable');
    if (!GOAL_GET_OUTPUT.safeParse(data).success) throw Error('goal_get_projection_unavailable');
    return data;
  };
  registerIpcHandler<[{ threadId: string }], GoalGetDto | null>({
    registrar: ipc, channel: GOAL_GET_CHANNEL, payloadMode: 'tuple',
    sourceFile: 'desktop/electron/goal-get-typed-ipc.ts', rolloutRound: 37,
    riskTags: ['fs-read', 'external-process', 'internal-mutation'],
    output: GOAL_GET_OUTPUT,
    beforeInput: event => { authorize(event); return undefined; },
    beforeOutput: event => { authorize(event); return undefined; },
    input: z.custom<[{ threadId: string }]>(() => true).transform((raw): [{ threadId: string }] => {
      const data = captureIpcData(raw, 'goal_get_input_invalid');
      if (!Array.isArray(data) || data.length !== 1 || !Object.hasOwn(data, '0')) throw Error('goal_get_input_invalid');
      const input: unknown = data[0];
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('goal_get_input_invalid');
      // Original getter ignored additional data fields; keep that behavior, without granting them.
      return [{ threadId: parseOriginalThreadId((input as { threadId?: unknown }).threadId) }];
    }),
    handler: args => {
      // Prevent ambient species from starting nested async producer effects.
      // This does NOT promise constructor-getter0 for the unchanged outer async wrappers.
      assertStandardIpcPromise(witness, 'goal_get_projection_unavailable');
      const raw = read(args[0].threadId);
      assertStandardIpcPromise(raw, 'goal_get_projection_unavailable');
      return new NativePromise<GoalGetDto | null>((resolve, reject) => apply(nativeThen, raw, [
        (value: GoalGetDto | null) => { try { resolve(captureOutput(value)); } catch (error) { reject(error); } },
        reject,
      ]));
    },
    captureOutput,
  });
}

