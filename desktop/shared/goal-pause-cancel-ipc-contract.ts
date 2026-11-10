import {z} from 'zod';
export const GOAL_PAUSE_CANCEL_METHODS = ['pause', 'cancel'] as const;
export type GoalPauseCancelMethod = typeof GOAL_PAUSE_CANCEL_METHODS[number];
export const GOAL_PAUSE_CANCEL_OUTPUT=z.object({threadId:z.string().min(1).max(200),status:z.enum(['paused','cancelled']),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict();
