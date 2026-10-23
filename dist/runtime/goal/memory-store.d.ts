import type { GoalCommitInput, GoalDocument, GoalStore } from './types.js';
import { type GoalCompletionIntent, type GoalCompletionIntentUpdate } from './completion-intent.js';
import { type GoalPublicationAttempt, type GoalPublicationAttemptUpdate } from './publication-attempt.js';
export declare class InMemoryGoalStore implements GoalStore {
    readonly documents: Map<string, GoalDocument>;
    failNextCommit: boolean;
    load(sessionId: string): Promise<GoalDocument | null>;
    updateCompletionIntent(sessionId: string, update: GoalCompletionIntentUpdate): Promise<void>;
    loadCompletionIntent(sessionId: string, intentId: string): Promise<GoalCompletionIntent | null>;
    listCompletionAttempts(sessionId: string, intentId: string): Promise<GoalPublicationAttempt[]>;
    updateCompletionAttempt(sessionId: string, update: GoalPublicationAttemptUpdate): Promise<void>;
    finalizeCompletionAttempt(sessionId: string, attemptId: string): Promise<GoalCompletionIntent>;
    commit(input: GoalCommitInput): Promise<void>;
}
