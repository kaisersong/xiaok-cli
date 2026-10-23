import type { AgentSessionState } from '../../ai/runtime/session.js';
import type { ProtectedObservationClosure } from '../../ai/runtime/protected-observation-closure.js';
import type { ManagedCompoundAdmission } from './compound-managed-admission.js';
/** Facts returned only by the captured Main adapter after authenticating its
 * private operation/preparation object. None of these DTOs issue authority. */
export interface ManagedCompoundFollowupFacts {
    readonly admission: ManagedCompoundAdmission;
    readonly childSession: AgentSessionState;
    readonly operationId: string;
    readonly previousTurnId: string;
    readonly nextTurnId: string;
    readonly rootEpoch: number;
    readonly message: string;
    readonly closure: ProtectedObservationClosure | undefined;
    readonly requestSource: 'user' | 'agent';
    /** Actual initiating runtime identity, captured by Main's fixed wrapper. */
    readonly origin?: Readonly<{
        session: AgentSessionState;
        nativeInvocationId: string;
    }>;
}
export interface ManagedCompoundFollowupAdapter {
    inspectPreparation(preparation: unknown): Readonly<ManagedCompoundFollowupFacts>;
    inspectApplied(receipt: unknown): Readonly<{
        preparation: object;
        operationId: string;
        nextTurnId: string;
        appliedDigest: string;
    }>;
    inspectCancelled(receipt: unknown): Readonly<{
        preparation: object;
        operationId: string;
        nextTurnId: string;
        cancelledDigest: string;
    }>;
}
export interface PreparedManagedCompoundFollowup {
    commitApplied(receipt: unknown): Promise<void>;
    cancelBeforeApplied(receipt: unknown): Promise<void>;
}
