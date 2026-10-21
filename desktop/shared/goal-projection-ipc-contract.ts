import { z } from 'zod';
import type { DesktopGoalProjection } from '../electron/desktop-goal-coordinator.js';

// Complete public data type; no owner/controller/report/commit authority is transported.
const text = z.string(), number = z.number().finite();
export const GOAL_PROJECTION_STATE = z.object({
  goalId: text, revision: number, epoch: number, sessionId: text,
  forkedFromGoalId: text.optional(), objective: text, completionCriterion: text.optional(),
  expectedEvidenceKinds: z.array(z.enum(['answer', 'file_artifact', 'command_action', 'project_update'])),
  status: z.enum(['active', 'paused', 'blocked', 'complete', 'cancelled']),
  turnsUsed: number, tokensUsed: number, activeWallClockMs: number,
  budgetLimits: z.object({ turnLimit: number, tokenLimit: number.optional(), activeWallClockLimitMs: number.optional() }).strict(),
  terminalReason: text.optional(), pendingCompletionIntentId: text.optional(), blockerFingerprint: text.optional(),
  consecutiveBlockedTurns: number, createdAt: number, updatedAt: number,
}).strict();
export const GOAL_PROJECTION_COMPLETION = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ordinary') }).strict(),
  z.object({ kind: z.literal('unavailable') }).strict(),
  z.object({ kind: z.literal('protected'), state: z.enum([
    'binding_required', 'binding_pending', 'binding_mismatch',
    'needs_revalidation', 'publication_pending', 'verified',
  ]) }).strict(),
]);
export const GOAL_PROJECTION_OUTPUT = z.object({
  state: GOAL_PROJECTION_STATE, activation: z.enum(['armed', 'disarmed']),
  waitingReason: z.enum(['waiting_children', 'children_need_attention']).optional(),
  currentCompletion: GOAL_PROJECTION_COMPLETION.optional(),
}).strict() satisfies z.ZodType<DesktopGoalProjection>;
export type GoalProjectionDto = z.infer<typeof GOAL_PROJECTION_OUTPUT>;

