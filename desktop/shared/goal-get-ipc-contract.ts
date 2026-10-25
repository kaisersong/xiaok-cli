import { z } from 'zod';
import { GOAL_PROJECTION_OUTPUT } from './goal-projection-ipc-contract.js';
export { GOAL_PROJECTION_STATE as GOAL_GET_STATE, GOAL_PROJECTION_COMPLETION as GOAL_GET_COMPLETION } from './goal-projection-ipc-contract.js';
export const GOAL_GET_CHANNEL = 'desktop:goal:get' as const;
export const GOAL_GET_OUTPUT = GOAL_PROJECTION_OUTPUT.nullable();
export type GoalGetDto = z.infer<typeof GOAL_GET_OUTPUT>;
