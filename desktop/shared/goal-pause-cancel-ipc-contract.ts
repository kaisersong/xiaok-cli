import { GOAL_PROJECTION_OUTPUT } from './goal-projection-ipc-contract.js';
export const GOAL_PAUSE_CANCEL_METHODS = ['pause', 'cancel'] as const;
export type GoalPauseCancelMethod = typeof GOAL_PAUSE_CANCEL_METHODS[number];
export const GOAL_PAUSE_CANCEL_OUTPUT = GOAL_PROJECTION_OUTPUT;
