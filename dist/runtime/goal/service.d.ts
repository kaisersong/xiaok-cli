import { FileGoalNativeJournal, type GoalNativeMutation } from './native-mutation-journal.js';
import { type GoalCompletionIntent } from './completion-intent.js';
import type { GoalDocument, GoalEvidenceEnvelope, GoalInput, GoalMutationContext, GoalOwnershipPort, GoalState, GoalStore } from './types.js';
export interface GoalServiceOptions {
    store: GoalStore;
    ownership: GoalOwnershipPort;
    now?: () => number;
    nativeJournal?: FileGoalNativeJournal;
}
export declare class GoalService {
    private readonly options;
    private readonly now;
    constructor(options: GoalServiceOptions);
    load(sessionId: string): Promise<GoalDocument | null>;
    requestCompletion(context: GoalMutationContext, input: {
        taskId: string;
        turnId: string;
        summary: string;
    }): Promise<GoalCompletionIntent>;
    /** Persist an unapproved draft. This does not activate a Goal or authorize a
     * native request; both later phases must revalidate this complete basis. */
    reserveNativeMutation(context: GoalMutationContext, raw: {
        kind: 'create' | 'replace';
        input: GoalInput;
        definition: unknown;
        minimumEpoch?: number;
    }): Promise<GoalNativeMutation>;
    /** Explicit new-session fork. Original rules come only from the installed
     * authority; no caller-selected definition or previous proof is inherited. */
    reserveNativeFork(context: GoalMutationContext, sourceSessionId: string, signal?: AbortSignal): Promise<GoalNativeMutation>;
    /** Fetch the original application's signed observation outside the host queue.
     * The closure consumes it once at the store's actual CAS boundary. */
    prepareNativeMutationCommit(context: GoalMutationContext, mutationId: string, signal?: AbortSignal, assertAdmission?: () => void): Promise<{
        commit(): Promise<GoalState>;
    }>;
    /** Repairs only the post-commit journal gap. No Goal write, arm or SDK call. */
    recoverNativeMutationCommit(context: GoalMutationContext, mutationId: string, signal?: AbortSignal): Promise<GoalState>;
    create(context: GoalMutationContext, input: GoalInput): Promise<GoalState>;
    fork(context: GoalMutationContext, source: GoalState): Promise<GoalState>;
    pause(context: GoalMutationContext, reason: string): Promise<GoalState>;
    resume(context: GoalMutationContext, input?: {
        turnLimit?: number;
    }): Promise<GoalState>;
    resumePublication(context: GoalMutationContext): Promise<GoalState>;
    cancel(context: GoalMutationContext, reason: string): Promise<GoalState>;
    replace(context: GoalMutationContext, input: GoalInput): Promise<GoalState>;
    complete(context: GoalMutationContext, reason: string): Promise<GoalState>;
    /** Project only the original claim's committed publication; never approves it. */
    completeClaim(context: GoalMutationContext, intentId: string): Promise<GoalState>;
    /** Capture the fixed authority observation outside a host's serial queue.
     * The returned closure performs only ownership/CAS/persistence and is single use. */
    prepareClaimCompletion(context: GoalMutationContext, intentId: string): Promise<{
        commit(): Promise<GoalState>;
    }>;
    noteBlockedClaim(context: GoalMutationContext, input: {
        reason: string;
        fingerprint: string;
    }): Promise<GoalState>;
    recordTurn(context: GoalMutationContext, input: {
        turnId: string;
        tokensUsed: number;
        activeWallClockMs: number;
        evidence?: Array<GoalEvidenceEnvelope['record']>;
    }): Promise<GoalState>;
    settleTurn(context: GoalMutationContext, input: {
        turnId: string;
        tokensUsed: number;
        activeWallClockMs: number;
        evidence?: Array<GoalEvidenceEnvelope['record']>;
        terminalDecision: {
            kind: 'none';
        } | {
            kind: 'complete';
            reason: string;
        } | {
            kind: 'publication_pending';
            intentId: string;
        } | {
            kind: 'blocked';
            reason: string;
            fingerprint?: string;
        } | {
            kind: 'blocker';
            reason: string;
            fingerprint: string;
            threshold?: number;
        } | {
            kind: 'paused';
            reason: string;
        };
    }): Promise<GoalState>;
    private mutate;
    private commit;
    private isDuplicateTurn;
    private requireCurrent;
    private assertOwned;
    private requireSource;
    private event;
}
