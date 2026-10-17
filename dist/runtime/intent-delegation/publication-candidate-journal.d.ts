import { type IntentBusinessProjection } from './business-projection.js';
import { type IntentReceiverAttempt, type IntentReceiverMutation } from './receiver-publication-journal.js';
import { type IntentVerificationMutation } from './verification-execution-journal.js';
import { type IntentCandidateBody } from '../verification/intent-application-binding.js';
import type { SessionIntentLedger } from './types.js';
import type { PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
export interface IntentArtifactSelection {
    artifactId: string;
    obligationId: string;
    path: string;
}
export interface IntentFileObservation {
    artifactId: string;
    sha256: string;
    size: number;
    identity: string;
}
export interface IntentApplicationObservationFact {
    state: 'not_prepared' | 'not_approved' | 'pending' | 'reauthorization_required' | 'registration_changed' | 'committed';
    challengePhase: null | 'prepared' | 'authorizing' | 'approved' | 'committed' | 'failed' | 'retired' | 'not_approved';
    challengeId: string | null;
    reviewHash: string | null;
    registrationHash: string | null;
    deadline: null | {
        domainId: string;
        qualificationEpoch: number;
        notBefore: number;
        validUntil: number;
    };
    current: null | {
        bindingHash: string;
        revision: number;
    };
    pendingTransitionId: string | null;
}
export interface IntentApplicationAttempt {
    requestId: string;
    revision: number;
    phase: 'reserved' | 'preparing' | 'ready' | 'retired' | 'stale' | 'needs_reauthorization';
    route: string | null;
    observation: IntentApplicationObservationFact | null;
    retirementReason: null | 'not_prepared' | 'not_approved' | 'registration_changed' | 'source_changed';
    createdAt: number;
    updatedAt: number;
}
export interface IntentPublicationCandidate {
    version: 1;
    id: string;
    intentId: string;
    stageId: string | null;
    candidateRevision: number;
    contractHash: string;
    body: Readonly<IntentCandidateBody>;
    bodyHash: string;
    bindingHash: string;
    sourceHash: string;
    fileObservations: IntentFileObservation[];
    createdAt: number;
    applicationAttempts: IntentApplicationAttempt[];
    receiverAttempts?: IntentReceiverAttempt[];
    businessProjection?: IntentBusinessProjection;
}
export interface ReserveIntentPublicationInput {
    sessionId: string;
    instanceId: string;
    expectedLedgerHash: string;
    artifactSelections: IntentArtifactSelection[];
    fileObservations: IntentFileObservation[];
    requestSource: 'user';
    now: number;
}
export interface ClaimIntentPublicationInput {
    sessionId: string;
    instanceId: string;
    candidateId: string;
    expectedLedgerHash: string;
    expectedRequestId: string;
    expectedRevision: number;
    route: string;
    requestSource: 'user';
    now: number;
}
export interface ObserveIntentPublicationInput {
    sessionId: string;
    instanceId: string;
    candidateId: string;
    expectedLedgerHash: string;
    expectedRequestId: string;
    expectedRevision: number;
    observation: unknown;
    sourceChanged: boolean;
    requestSource: 'user' | 'scheduler';
    now: number;
}
export type RetryIntentPublicationInput = Omit<ClaimIntentPublicationInput, 'route'>;
export type ReserveIntentParentPublicationInput = Omit<ReserveIntentPublicationInput, 'artifactSelections'> & {
    references: readonly import('../verification/intent-application-binding.js').IntentStagePublicationReference[];
};
export type IntentPublicationMutation = (ReserveIntentParentPublicationInput & {
    publicationAction: 'reserve-parent';
}) | (ReserveIntentPublicationInput & {
    publicationAction: 'reserve';
}) | (ClaimIntentPublicationInput & {
    publicationAction: 'claim';
}) | (ObserveIntentPublicationInput & {
    publicationAction: 'observe';
}) | (RetryIntentPublicationInput & {
    publicationAction: 'retry';
}) | IntentVerificationMutation | IntentReceiverMutation;
export declare function captureIntentPublicationRequest(raw: ReserveIntentPublicationInput & {
    lease: SessionExecutionLease;
}): {
    input: {
        publicationAction: "reserve";
        sessionId: string;
        instanceId: string;
        expectedLedgerHash: string;
        artifactSelections: IntentArtifactSelection[];
        fileObservations: IntentFileObservation[];
        requestSource: "user";
        now: number;
    };
    lease: SessionExecutionLease;
};
export declare function captureIntentPublicationClaim(raw: ClaimIntentPublicationInput & {
    lease: SessionExecutionLease;
}): {
    input: {
        publicationAction: "claim";
        sessionId: string;
        instanceId: string;
        candidateId: string;
        expectedLedgerHash: string;
        expectedRequestId: string;
        expectedRevision: number;
        route: string;
        requestSource: "user";
        now: number;
    };
    lease: SessionExecutionLease;
};
export declare function captureIntentPublicationObservation(raw: ObserveIntentPublicationInput & {
    lease: SessionExecutionLease;
}): {
    input: {
        publicationAction: "observe";
        sessionId: string;
        instanceId: string;
        candidateId: string;
        expectedLedgerHash: string;
        expectedRequestId: string;
        expectedRevision: number;
        observation: unknown;
        sourceChanged: boolean;
        requestSource: "user" | "scheduler";
        now: number;
    };
    lease: SessionExecutionLease;
};
export declare function captureIntentPublicationRetry(raw: RetryIntentPublicationInput & {
    lease: SessionExecutionLease;
}): {
    input: {
        publicationAction: "retry";
        sessionId: string;
        requestSource: "user";
        candidateId: string;
        now: number;
        expectedRevision: number;
        instanceId: string;
        expectedLedgerHash: string;
        expectedRequestId: string;
    };
    lease: SessionExecutionLease;
};
export declare function intentPublicationTarget(ledger: SessionIntentLedger, row: IntentPublicationCandidate): Readonly<import("../verification/intent-application-binding.js").IntentApplicationBinding>;
export declare function parseIntentPublicationCandidates(ledger: SessionIntentLedger | undefined): IntentPublicationCandidate[];
/** Capture source data only; actual native/verification remains in the fixed host. */
export declare function applyIntentPublicationMutation(previous: PersistedSessionSnapshot, input: IntentPublicationMutation): PersistedSessionSnapshot;
export declare function assertIntentPublicationRetained(previous: SessionIntentLedger | undefined, next: SessionIntentLedger | undefined, primitive?: boolean | 'receiver' | 'projection'): void;
export declare function intentPublicationRouteVector(ledger: SessionIntentLedger | undefined, candidateId?: string): string;
export declare function assertIntentPublicationRoute(ledger: SessionIntentLedger | undefined, original: string, candidateId?: string | null): void;
/** Fixed local mutation fence, distinct from the stored single application route. */
export declare function intentPublicationMutationCandidateId(ledger: SessionIntentLedger | undefined, input: IntentPublicationMutation): string | null | undefined;
export declare function intentPublicationMutationRouteVector(ledger: SessionIntentLedger | undefined, candidateId?: string | null): string;
