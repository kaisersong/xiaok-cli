import { z } from 'zod';
import { GOAL_PROJECTION_OUTPUT } from './goal-projection-ipc-contract.js';
import { GOAL_NATIVE_QUERY_OUTPUT } from './goal-native-query-ipc-contract.js';
import type { DesktopApi } from '../electron/preload-api.js';
export const GOAL_ATTACHMENT_NATIVE_METHODS = [
  'ackTaskAttached', 'recoverNativeMutation', 'continueNativeMutation', 'cancelNativeMutation',
] as const;
export type GoalAttachmentNativeMethod = typeof GOAL_ATTACHMENT_NATIVE_METHODS[number];

// Identical complete public correlation DTO, reused without SDK authority or stronger bounds.
import { GOAL_TASK_PREPARED_OUTPUT as GOAL_PUBLIC_PREPARED_TASK } from './goal-task-mutation-ipc-contract.js';
export { GOAL_PUBLIC_PREPARED_TASK };
// Public mutation summary requires nonnull; reuse the complete existing four-field schema.
const mutation = GOAL_NATIVE_QUERY_OUTPUT.unwrap();
export const GOAL_ATTACHMENT_NATIVE_OUTPUTS = {
  ackTaskAttached: z.undefined() satisfies z.ZodType<Awaited<ReturnType<DesktopApi['ackGoalTaskAttached']>>>,
  recoverNativeMutation: z.object({ mutation, goal: GOAL_PROJECTION_OUTPUT.nullable() }).strict() satisfies z.ZodType<Awaited<ReturnType<DesktopApi['recoverGoalNativeMutation']>>>,
  continueNativeMutation: z.object({ goal: GOAL_PROJECTION_OUTPUT, preparedTask: GOAL_PUBLIC_PREPARED_TASK }).strict() satisfies z.ZodType<Awaited<ReturnType<DesktopApi['continueGoalNativeMutation']>>>,
  cancelNativeMutation: mutation satisfies z.ZodType<Awaited<ReturnType<DesktopApi['cancelGoalNativeMutation']>>>,
} as const;

