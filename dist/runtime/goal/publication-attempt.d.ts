import { type GoalApplicationBinding } from '../verification/goal-application-binding.js';
import type { PublicationChallenge, PublicationObservation, PublicationRequestRecovery, PublicationSource } from '../verification/publication-client.js';
import { type GoalCompletionIntent } from './completion-intent.js';
export interface GoalPublicationAttempt {
    attemptId: string;
    intentId: string;
    application: Readonly<GoalApplicationBinding>;
    requestSource: PublicationSource;
    sequence: number;
    revision: number;
    status: 'preparing' | 'prepared' | 'authorizing' | 'pending' | 'not_prepared' | 'not_approved' | 'committed' | 'cancelled';
    challenge: Readonly<PublicationChallenge> | null;
    observation: Readonly<PublicationObservation> | null;
    retirement: Exclude<PublicationRequestRecovery, {
        status: 'settlement_exists';
    }> | null;
    createdAt: number;
    updatedAt: number;
}
export interface GoalPublicationAttemptUpdate {
    expectedRevision: number | null;
    next: GoalPublicationAttempt;
}
export declare function isGoalPublicationAttemptTerminal(attempt: GoalPublicationAttempt): boolean;
export declare function createGoalPublicationAttempt(intent: GoalCompletionIntent, requestSource: PublicationSource, now: number, sequence: number): GoalPublicationAttempt;
/** Pure journal validation invoked inside the actual store's transaction/queue. */
export declare function applyGoalPublicationAttemptUpdate(current: readonly GoalPublicationAttempt[], intent: GoalCompletionIntent, update: GoalPublicationAttemptUpdate): GoalPublicationAttempt[];
/** The store supplies its own original row, never a caller-provided observation. */
export declare function finalizeGoalPublicationAttempt(intent: GoalCompletionIntent, attempts: readonly GoalPublicationAttempt[], attemptId: string): GoalCompletionIntent;
/** Checks the complete stored journal without replaying native effects. */
export declare function validateCapturedGoalCompletionIntents(intents: readonly GoalCompletionIntent[], attempts: readonly GoalPublicationAttempt[]): void;
/** Checks the complete stored journal without replaying native effects. */
export declare function parseGoalPublicationJournal(intents: readonly GoalCompletionIntent[], raw: readonly GoalPublicationAttempt[]): GoalPublicationAttempt[];
