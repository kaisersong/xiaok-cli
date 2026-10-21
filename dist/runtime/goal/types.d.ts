import type { CompletionEvidenceRecord, CompletionKind } from '../guards/completion-evidence.js';
import type { GoalCompletionIntent, GoalCompletionIntentUpdate } from './completion-intent.js';
import type { GoalPublicationAttempt, GoalPublicationAttemptUpdate } from './publication-attempt.js';
export declare const DEFAULT_GOAL_TURN_LIMIT = 20;
export declare const MAX_GOAL_TURN_LIMIT = 50;
export type GoalStatus = 'active' | 'paused' | 'blocked' | 'complete' | 'cancelled';
export type GoalRequestSource = 'user' | 'agent' | 'runtime';
export type GoalActivation = 'armed' | 'disarmed';
export type GoalEvidenceKind = Extract<CompletionKind, 'answer' | 'file_artifact' | 'command_action' | 'project_update'>;
export interface GoalBudgetLimits {
    turnLimit: number;
    tokenLimit?: number;
    activeWallClockLimitMs?: number;
}
export interface GoalInput {
    objective: string;
    completionCriterion?: string;
    expectedEvidenceKinds: GoalEvidenceKind[];
    turnLimit?: number;
}
/** Original user-supplied criteria; main/CLI parse the complete definition. */
export interface GoalCreationInput extends GoalInput {
    verificationDefinition?: unknown;
}
export interface GoalState {
    goalId: string;
    revision: number;
    epoch: number;
    sessionId: string;
    forkedFromGoalId?: string;
    objective: string;
    completionCriterion?: string;
    expectedEvidenceKinds: GoalEvidenceKind[];
    status: GoalStatus;
    turnsUsed: number;
    tokensUsed: number;
    activeWallClockMs: number;
    budgetLimits: GoalBudgetLimits;
    terminalReason?: string;
    /** Durable pending publication selector; never proof or approval. */
    pendingCompletionIntentId?: string;
    blockerFingerprint?: string;
    consecutiveBlockedTurns: number;
    createdAt: number;
    updatedAt: number;
}
export interface GoalRef {
    goalId: string;
    revision: number;
}
export interface GoalMutationContext {
    sessionId: string;
    instanceId: string;
    requestSource: GoalRequestSource;
    expectedRevision: number | null;
}
export interface GoalTurnRecord {
    goalId: string;
    epoch: number;
    turnId: string;
    tokensUsed: number;
    activeWallClockMs: number;
    recordedAt: number;
}
export interface GoalEvidenceEnvelope {
    goalId: string;
    epoch: number;
    goalTurnId: string;
    evidenceId: string;
    record: CompletionEvidenceRecord;
    recordedAt: number;
}
export interface GoalEvent {
    eventId: string;
    goalId: string;
    revision: number;
    type: string;
    actor: GoalRequestSource;
    recordedAt: number;
    reason?: string;
}
export interface GoalDocument {
    state: GoalState;
    events: GoalEvent[];
    turns: GoalTurnRecord[];
    evidence: GoalEvidenceEnvelope[];
    completionIntents?: GoalCompletionIntent[];
    completionAttempts?: GoalPublicationAttempt[];
}
export interface GoalCommitInput {
    sessionId: string;
    expectedRevision: number | null;
    next: GoalState;
    events: GoalEvent[];
    turns: GoalTurnRecord[];
    evidence: GoalEvidenceEnvelope[];
    completionIntent?: GoalCompletionIntentUpdate;
    /** Original durable claim selector, never an approval or a persisted write grant. */
    completionIntentId?: string;
    /** Private one-attempt cache projection ticket; never persisted. */
    completionProjection?: object;
    /** Private one-attempt native application cache projection; never persisted. */
    nativeProjection?: object;
}
export interface GoalStore {
    load(sessionId: string): Promise<GoalDocument | null>;
    /** Exact historical claim, including a Goal no longer selected by the session. */
    loadCompletionIntent(sessionId: string, intentId: string): Promise<GoalCompletionIntent | null>;
    listCompletionAttempts(sessionId: string, intentId: string): Promise<GoalPublicationAttempt[]>;
    updateCompletionAttempt(sessionId: string, update: GoalPublicationAttemptUpdate): Promise<void>;
    finalizeCompletionAttempt(sessionId: string, attemptId: string): Promise<GoalCompletionIntent>;
    commit(input: GoalCommitInput): Promise<void>;
    /** Updates original recovery facts only, without changing any Goal state/pointer. */
    updateCompletionIntent(sessionId: string, update: GoalCompletionIntentUpdate): Promise<void>;
}
export interface GoalOwnershipPort {
    assertOwned(sessionId: string, instanceId: string): void | Promise<void>;
}
