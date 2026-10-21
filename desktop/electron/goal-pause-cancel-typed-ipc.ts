// Typed transport for both original same-permission Goal pause/cancel registrations.
import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { createDesktopServices } from './desktop-services.js';
import type { DesktopGoalProjection } from './desktop-goal-coordinator.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler } from './ipc-runtime.js';
import { GOAL_PAUSE_CANCEL_OUTPUT } from '../shared/goal-pause-cancel-ipc-contract.js';
import { callGoalPauseCancelProducer, captureGoalPauseCancelOutput } from './goal-pause-cancel-boundary.js';
type Services = ReturnType<typeof createDesktopServices>;
// Exact existing public producer signatures. No business/controller/SDK substitute.
export function registerGoalPauseCancelIpc(
  ipc: IpcHandleRegistrar, pause: Services['pauseGoal'], cancel: Services['cancelGoal'],
  parseOriginalThreadId: (value: unknown) => string,
  authorize: (event: IpcMainInvokeEvent) => void,
): void {
  for (const [method, producer] of [['pause', pause], ['cancel', cancel]] as const) {
    registerIpcHandler<[{threadId: string}], DesktopGoalProjection>({
      registrar: ipc, channel: `desktop:goal:${method}`, payloadMode: 'tuple', rolloutRound: 37,
      sourceFile: 'desktop/electron/goal-pause-cancel-typed-ipc.ts', riskTags: ['fs-read', 'fs-write', 'exec'],
      beforeInput: event => { authorize(event); return undefined; },
      beforeOutput: event => { authorize(event); return undefined; },
      input: z.custom<[{threadId: string}]>(() => true).transform(raw => {
        const data = captureIpcData(raw, 'goal_pause_cancel_input_invalid');
        if (!Array.isArray(data) || data.length !== 1 || !Object.hasOwn(data, '0')) throw Error('goal_pause_cancel_input_invalid');
        const payload: unknown = data[0];
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('goal_pause_cancel_input_invalid');
        // Keep original trim/200 UTF-16/domain error. Unknown data keys remain ignored.
        return [{threadId: parseOriginalThreadId(Reflect.get(payload, 'threadId'))}];
      }),
      handler: args => callGoalPauseCancelProducer(() => producer(args[0].threadId)),
      captureOutput: captureGoalPauseCancelOutput, output: GOAL_PAUSE_CANCEL_OUTPUT,
    });
  }
}
