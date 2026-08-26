import type { GoalDocument, GoalEvidenceEnvelope, GoalInput, GoalMutationContext, GoalOwnershipPort, GoalState, GoalStore } from './types.js';
export interface GoalServiceOptions {
    store: GoalStore;
    ownership: GoalOwnershipPort;
    now?: () => number;
}
export declare class GoalService {
    private readonly options;
    private readonly now;
    constructor(options: GoalServiceOptions);
    load(sessionId: string): Promise<GoalDocument | null>;
    create(context: GoalMutationContext, input: GoalInput): Promise<GoalState>;
    fork(context: GoalMutationContext, source: GoalState): Promise<GoalState>;
    pause(context: GoalMutationContext, reason: string): Promise<GoalState>;
    resume(context: GoalMutationContext, input?: {
        turnLimit?: number;
    }): Promise<GoalState>;
    cancel(context: GoalMutationContext, reason: string): Promise<GoalState>;
    replace(context: GoalMutationContext, input: GoalInput): Promise<GoalState>;
    complete(context: GoalMutationContext, reason: string): Promise<GoalState>;
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
    private requireCurrent;
    private assertOwned;
    private requireSource;
    private event;
}
