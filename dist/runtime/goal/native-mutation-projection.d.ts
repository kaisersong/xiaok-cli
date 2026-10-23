import type { GoalApplicationBinding } from '../verification/goal-application-binding.js';
import type { GoalCommitInput, GoalState, GoalStore } from './types.js';
/** Fresh fixed-endpoint observation for crashgap repair; never an execution grant. */
export declare function assertGoalNativeApplicationCurrent(binding: Readonly<GoalApplicationBinding>, signal?: AbortSignal): Promise<void>;
/** An actual installed application observation authorizes one exact cache write.
 * It is not a native approval, current verification, or SDK execution grant. */
export declare function authorizeGoalNativeProjection(store: GoalStore, raw: GoalCommitInput, mutation: unknown, signal?: AbortSignal, assertAdmission?: () => void): Promise<GoalCommitInput>;
/** Consume immediately, before cloning or another projection's checks can fail.
 * The returned check is used only inside the consuming store's actual lock. */
export declare function consumeGoalNativeProjection(store: GoalStore, token: unknown): (current: GoalState | null, input: GoalCommitInput) => void;
