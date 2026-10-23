import type { GoalState } from './types.js';
export type GoalCompletionObservation = {
    readonly kind: 'ordinary';
} | {
    readonly kind: 'unavailable';
} | {
    readonly kind: 'protected';
    readonly state: 'binding_required' | 'binding_pending' | 'binding_mismatch' | 'needs_revalidation' | 'publication_pending' | 'verified';
};
/** A local Goal cache, including status=complete, is not current authority. */
export declare function unobservedGoalCompletion(state: GoalState): GoalCompletionObservation;
/** Fresh display only. Never persist this DTO or use it to admit execution. */
export declare function observeGoalCompletion(raw: GoalState, signal?: AbortSignal): Promise<GoalCompletionObservation>;
