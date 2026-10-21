import { type IntentVerificationOperation, type IntentVerificationOperationAction } from './verification-operation-journal.js';
import { type OwnerEnrollmentReview } from '../verification/owner-enrollment-review.js';
import type { OwnerEnrollmentRequestRecovery } from '../verification/owner-enrollment-request.js';
import { type ValidationMaterialDraft, type ValidationMaterialInvocation } from '../verification/product-material-authorization.js';
import type { SessionIntentLedger } from './types.js';
import type { PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
export interface IntentVerificationExecution {
    version: 1;
    id: string;
    candidateId: string;
    obligationId: string;
    bindingHash: string;
    sourceHash: string;
    invocation: ValidationMaterialInvocation;
    enrollmentRequestId: string;
    materialRequestId: string;
    verificationRequestId: string;
    draft: Readonly<ValidationMaterialDraft>;
    registration: OwnerEnrollmentReview['registration'];
    route: string;
    originalSource: 'user';
    phase: 'reserved' | 'enrolling' | 'enrolled' | 'retired';
    enrollmentObservation: EnrollmentFact | null;
    operation: IntentVerificationOperation | null;
    revision: number;
    createdAt: number;
    updatedAt: number;
}
export type EnrollmentFact = {
    state: 'not_prepared';
} | {
    state: 'not_approved' | 'committed';
    challengeId: string;
    reviewHash: string;
    enrollmentHash: string;
    registrationHash: string;
    authorityId: string;
};
export interface RecordIntentVerificationOperationInput {
    sessionId: string;
    instanceId: string;
    id: string;
    expectedLedgerHash: string;
    expectedRevision: number;
    requestSource: 'user' | 'scheduler';
    now: number;
    action: IntentVerificationOperationAction;
}
export interface ObserveIntentVerificationInput {
    sessionId: string;
    instanceId: string;
    id: string;
    expectedLedgerHash: string;
    expectedRevision: number;
    requestSource: 'user' | 'scheduler';
    now: number;
    observation: OwnerEnrollmentRequestRecovery;
}
export interface ReserveIntentVerificationInput {
    sessionId: string;
    instanceId: string;
    candidateId: string;
    obligationId: string;
    expectedLedgerHash: string;
    requestSource: 'user';
    now: number;
    registration: OwnerEnrollmentReview['registration'];
    exactCommand: ValidationMaterialDraft['exactCommand'];
    materials: ValidationMaterialDraft['materials'];
    expiresAt: number;
}
export interface ClaimIntentVerificationInput {
    sessionId: string;
    instanceId: string;
    id: string;
    expectedLedgerHash: string;
    expectedRevision: number;
    requestSource: 'user';
    now: number;
}
export type IntentVerificationMutation = (RecordIntentVerificationOperationInput & {
    verificationAction: 'operation';
    publicationAction: 'verification';
}) | (ObserveIntentVerificationInput & {
    verificationAction: 'observe-enrollment';
    publicationAction: 'verification';
}) | (ReserveIntentVerificationInput & {
    verificationAction: 'reserve';
    publicationAction: 'verification';
}) | (ClaimIntentVerificationInput & {
    verificationAction: 'claim-enrollment';
    publicationAction: 'verification';
});
/** Durable identity and source facts only. No returned row grants native/execution/publication. */
export declare function parseIntentVerificationExecutions(ledger: SessionIntentLedger | undefined): IntentVerificationExecution[];
export declare function captureIntentVerificationReserve(raw: ReserveIntentVerificationInput & {
    lease: SessionExecutionLease;
}): {
    input: Extract<IntentVerificationMutation, {
        verificationAction: "reserve";
    }>;
    lease: SessionExecutionLease;
};
export declare function captureIntentVerificationClaim(raw: ClaimIntentVerificationInput & {
    lease: SessionExecutionLease;
}): {
    input: Extract<IntentVerificationMutation, {
        verificationAction: "claim-enrollment";
    }>;
    lease: SessionExecutionLease;
};
export declare function captureIntentVerificationObservation(raw: ObserveIntentVerificationInput & {
    lease: SessionExecutionLease;
}): {
    input: Extract<IntentVerificationMutation, {
        verificationAction: "observe-enrollment";
    }>;
    lease: SessionExecutionLease;
};
export declare function captureIntentVerificationOperation(raw: RecordIntentVerificationOperationInput & {
    lease: SessionExecutionLease;
}): {
    input: Extract<IntentVerificationMutation, {
        verificationAction: "operation";
    }>;
    lease: SessionExecutionLease;
};
export declare function applyIntentVerificationMutation(previous: PersistedSessionSnapshot, input: IntentVerificationMutation): PersistedSessionSnapshot;
export declare function assertIntentVerificationRetained(before: SessionIntentLedger | undefined, after: SessionIntentLedger | undefined, primitive?: boolean): void;
