import { type IntentBusinessProjection } from './business-projection.js';
import { type IntentReceiverAttempt, type IntentReceiverMutation } from './receiver-publication-journal.js';
import { type IntentVerificationMutation } from './verification-execution-journal.js';
import { createIntentApplicationBinding, type IntentCandidateBody } from '../verification/intent-application-binding.js';
import type { SessionIntentLedger } from './types.js';
import type { StoredSessionIntentLedgerInput } from './stored-intent-clone.js';
import type { StoredSessionSnapshot } from '../../ai/runtime/session-store/stored-snapshot-types.js';
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
        expectedRevision: number;
        requestSource: "user";
        candidateId: string;
        now: number;
        instanceId: string;
        expectedLedgerHash: string;
        expectedRequestId: string;
    };
    lease: SessionExecutionLease;
};
export interface IntentPublicationTargetData {
    readonly sessionId: string;
    readonly nativeContracts?: unknown;
}
export interface IntentPublicationTargetRowData {
    readonly id: unknown;
    readonly intentId: string;
    readonly stageId: unknown;
    readonly candidateRevision: unknown;
    readonly contractHash: unknown;
    readonly body: unknown;
}
export declare function intentPublicationTarget(ledger: SessionIntentLedger, row: IntentPublicationCandidate): ReturnType<typeof createIntentApplicationBinding>;
export declare function intentPublicationTarget(ledger: IntentPublicationTargetData, row: IntentPublicationTargetRowData): ReturnType<typeof createIntentApplicationBinding>;
/** Read-only stored DATA. This is neither a Modern ledger nor an execution port. */
export interface IntentPublicationRecordFactsData {
    readonly intentId: string;
    readonly stages?: unknown;
    readonly overallStatus?: unknown;
    readonly producerReports?: unknown;
    readonly executionTerminals?: unknown;
    readonly artifacts?: unknown;
}
export interface IntentPublicationReaderLedgerData {
    readonly sessionId: string;
    readonly nativeContracts?: unknown;
    readonly publicationCandidates?: unknown;
    readonly intents: readonly IntentPublicationRecordFactsData[];
}
/** Prefix fields are validated with the original candidate/binding/attempt parsers.
 * Source projections and receiver history remain unknown until their real parser runs. */
export type IntentPublicationRowFactsData = Omit<IntentPublicationCandidate, 'receiverAttempts' | 'businessProjection'> & {
    readonly receiverAttempts?: unknown;
    readonly businessProjection?: unknown;
};
export declare function intentPublicationFactObject(value: unknown, code: string): Record<string, unknown>;
export declare function intentPublicationFactArray(value: unknown, code: string): readonly unknown[];
/** Selects one original row, never replaces the ledger, history or hash input.
 * This validates the existing row prefix, not full projection/receiver source or authority. */
export declare function readIntentPublicationRowFacts(ledger: IntentPublicationReaderLedgerData, intentId: string, stageId: unknown): IntentPublicationRowFactsData | undefined;
export declare function parseIntentPublicationCandidates(ledger: SessionIntentLedger | undefined): IntentPublicationCandidate[];
export declare function parseIntentPublicationCandidates(ledger: IntentPublicationReaderLedgerData | undefined): IntentPublicationCandidate[];
/** Capture source data only; actual native/verification remains in the fixed host. */
export declare function applyIntentPublicationMutation(previous: PersistedSessionSnapshot, input: IntentPublicationMutation): PersistedSessionSnapshot;
export declare function applyIntentPublicationMutation(previous: StoredSessionSnapshot, input: IntentPublicationMutation): StoredSessionSnapshot;
/** Snapshot fields consumed by the existing capture branches; not a full durable snapshot. */
export type IntentPublicationCaptureSnapshot = Pick<PersistedSessionSnapshot, 'sessionId' | 'intentDelegation' | 'updatedAt'>;
/** Actual storage DATA consumed by capture; the Modern view above is compatibility only. */
export type StoredIntentPublicationCaptureSnapshot = Pick<StoredSessionSnapshot, 'sessionId' | 'intentDelegation' | 'updatedAt'>;
export type IntentPublicationCaptureMutation = Exclude<IntentPublicationMutation, IntentReceiverMutation | IntentVerificationMutation>;
/** Plain DATA capture only. Existing owner/hash/journal/route checks remain in the body. */
export declare function applyIntentPublicationCapture(previous: PersistedSessionSnapshot, input: IntentPublicationCaptureMutation): PersistedSessionSnapshot;
export declare function applyIntentPublicationCapture(previous: StoredSessionSnapshot, input: IntentPublicationCaptureMutation): StoredSessionSnapshot;
export declare function applyIntentPublicationCapture(previous: IntentPublicationCaptureSnapshot, input: IntentPublicationCaptureMutation): IntentPublicationCaptureSnapshot;
export declare function applyIntentPublicationCapture(previous: StoredIntentPublicationCaptureSnapshot, input: IntentPublicationCaptureMutation): StoredIntentPublicationCaptureSnapshot;
export declare function assertIntentPublicationRetained(previous: SessionIntentLedger | undefined, next: SessionIntentLedger | undefined, primitive?: boolean | 'receiver' | 'projection'): void;
export declare function assertIntentPublicationRetained(previous: StoredSessionIntentLedgerInput | undefined, next: StoredSessionIntentLedgerInput | undefined, primitive?: boolean | 'receiver' | 'projection'): void;
export declare function intentPublicationRouteVector(ledger: SessionIntentLedger | undefined, candidateId?: string): string;
export declare function intentPublicationRouteVector(ledger: StoredSessionIntentLedgerInput | undefined, candidateId?: string): string;
export declare function assertIntentPublicationRoute(ledger: SessionIntentLedger | undefined, original: string, candidateId?: string | null): void;
export declare function assertIntentPublicationRoute(ledger: StoredSessionIntentLedgerInput | undefined, original: string, candidateId?: string | null): void;
/** Fixed local mutation fence, distinct from the stored single application route. */
export declare function intentPublicationMutationCandidateId(ledger: SessionIntentLedger | undefined, input: IntentPublicationMutation): string | null | undefined;
export declare function intentPublicationMutationCandidateId(ledger: StoredSessionIntentLedgerInput | undefined, input: IntentPublicationMutation): string | null | undefined;
export declare function intentPublicationMutationRouteVector(ledger: SessionIntentLedger | undefined, candidateId?: string | null): string;
export declare function intentPublicationMutationRouteVector(ledger: StoredSessionIntentLedgerInput | undefined, candidateId?: string | null): string;
