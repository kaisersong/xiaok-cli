import type { GoalCommitInput, GoalState, GoalStore } from './types.js';
export declare function captureGoalCommit(input: GoalCommitInput): GoalCommitInput;
/** Observe the original signed receiver commit through fixed installed endpoints.
 * This grants only a cache projection of that historical commit, never current
 * verification or permission to execute. There is no injectable authority port. */
export declare function authorizeGoalCompletionProjection(store: GoalStore, raw: GoalCommitInput, signal?: AbortSignal): Promise<GoalCommitInput>;
/** Actual store queue/transaction boundary. Public observations and copied tokens
 * cannot authorize writes; all original data is bound to the one consuming store. */
export declare function captureGoalCommitForStore(store: GoalStore, raw: GoalCommitInput): {
    input: GoalCommitInput;
    assertProjection(current: GoalState | null): void;
};
