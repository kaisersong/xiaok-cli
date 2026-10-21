import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import type { SessionStore } from '../../ai/runtime/session-store/store.js';
import type { IntentLedgerRecord } from './types.js';
import { type SessionSkillEvalState, type SkillFeedbackRecord, type SkillRoutingObservation } from './skill-eval.js';
export declare class SessionSkillEvalStore {
    private readonly sessionStore;
    private readonly scope;
    private tail;
    private readonly mutationPort?;
    constructor(sessionStore: SessionStore, options?: {
        withMutationLease: <T>(sessionId: string, work: (lease?: SessionExecutionLease) => Promise<T>) => Promise<T>;
    });
    /** Fixed host composition. No lease or write token is exposed to hook callers. */
    withMutation<T>(sessionId: string, work: () => Promise<T>): Promise<T>;
    assertMutationCurrent(sessionId: string): void;
    load(sessionId: string): Promise<SessionSkillEvalState | null>;
    ensureObservationsForIntent(sessionId: string, intent: IntentLedgerRecord): Promise<SessionSkillEvalState>;
    recordSkillInvocation(sessionId: string, input: {
        intentId: string;
        stepId: string;
        skillName: string;
        intent?: IntentLedgerRecord;
        now?: number;
    }): Promise<SessionSkillEvalState>;
    updateObservationStatus(sessionId: string, input: {
        intentId: string;
        stepId: string;
        status: SkillRoutingObservation['status'];
        now?: number;
    }): Promise<SessionSkillEvalState>;
    recordArtifact(sessionId: string, input: {
        intentId: string;
        stageId: string;
        structuralValidation: SkillRoutingObservation['structuralValidation'];
        semanticValidation: SkillRoutingObservation['semanticValidation'];
        now?: number;
    }): Promise<SessionSkillEvalState>;
    markPromptedIntent(sessionId: string, intentId: string, now?: number): Promise<SessionSkillEvalState>;
    recordFeedback(sessionId: string, feedback: SkillFeedbackRecord): Promise<SessionSkillEvalState>;
    private mutate;
    private requireSnapshot;
}
export declare function ensureObservationsForIntentState(state: SessionSkillEvalState, intent: IntentLedgerRecord, now?: number): SessionSkillEvalState;
