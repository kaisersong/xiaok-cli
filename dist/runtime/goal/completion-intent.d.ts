import { type GoalApplicationBinding } from '../verification/goal-application-binding.js';
import type { PublicationChallenge, PublicationObservation } from '../verification/publication-client.js';
import type { GoalState } from './types.js';
/** Recovery journal only. These values cannot approve publication or authorize a cache write. */
export interface GoalCompletionIntent {
    intentId: string;
    revision: number;
    application: Readonly<GoalApplicationBinding>;
    taskId: string;
    turnId: string;
    summary: string;
    status: 'claimed' | 'prepared' | 'authorizing' | 'pending' | 'committed' | 'cancelled' | 'superseded';
    challenge: Readonly<PublicationChallenge> | null;
    observation: Readonly<PublicationObservation> | null;
    createdAt: number;
    updatedAt: number;
}
export interface GoalCompletionIntentUpdate {
    expectedRevision: number | null;
    next: GoalCompletionIntent;
}
export declare function goalApplicationFromState(state: GoalState): Readonly<GoalApplicationBinding>;
export declare function createGoalCompletionIntent(input: {
    state: GoalState;
    taskId: string;
    turnId: string;
    summary: string;
    now: number;
}): GoalCompletionIntent;
export declare function parseGoalCompletionIntent(raw: GoalCompletionIntent): GoalCompletionIntent;
/** Pure captured-journal check for the legacy intent transition path. The
 * publication-attempt finalizer has a separate, original-store-bound path. */
export declare function validateGoalCompletionIntentRevision(intent: GoalCompletionIntent): void;
/** Called inside the actual store's CAS/transaction, never an authority issuer. */
export declare function applyGoalCompletionIntentUpdate(current: readonly GoalCompletionIntent[], update: GoalCompletionIntentUpdate | undefined, creationState?: GoalState): GoalCompletionIntent[];
