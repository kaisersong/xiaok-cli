import type { GoalState, GoalTurnRecord } from './types.js';
/** The durable boundary rejects replay before any counter or evidence write.
 * The service can recognize exact duplicates and continue publication recovery. */
export declare function assertGoalTurnAppend(current: readonly GoalTurnRecord[], incoming: readonly GoalTurnRecord[], state: Pick<GoalState, 'goalId' | 'epoch'>): void;
