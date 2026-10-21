// Original semantic transport/public data contract; business and native authority unchanged.
import { z } from 'zod';
import type { DesktopGoalMutationResult, DesktopGoalTaskPrepared } from '../electron/preload-api.js';
import { GOAL_PROJECTION_OUTPUT } from './goal-projection-ipc-contract.js';
const text = z.string(), number = z.number().finite();
export const GOAL_TASK_PREPARED_OUTPUT = z.object({
  attachmentId: text,
  attachmentSource: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('request'), requestId: text.nullable() }).strict(),
    z.object({ kind: z.literal('automatic'), predecessorTaskId: text }).strict(),
  ]),
  threadId: text, taskId: text,
  executionScope: z.object({ kind: z.literal('goal_turn'), origin: z.enum(['user', 'continuation']),
    goalId: text, epoch: number, goalTurnId: text, threadId: text }).strict(),
  goalRef: z.object({ goalId: text, revision: number }).strict(), expiresAt: number,
}).strict() satisfies z.ZodType<DesktopGoalTaskPrepared>;
export const GOAL_TASK_MUTATION_OUTPUT = z.object({
  goal: GOAL_PROJECTION_OUTPUT, preparedTask: GOAL_TASK_PREPARED_OUTPUT,
}).strict() satisfies z.ZodType<DesktopGoalMutationResult>;
