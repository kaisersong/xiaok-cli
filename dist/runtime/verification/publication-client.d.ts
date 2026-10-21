import type { createAuthenticatedControllerClient } from './controller-client.js';
import type { VerificationOwner } from './proof-authority.js';
import type { PublicationOperationReview } from './publication-operation-review.js';
export type PublicationSource = 'user' | 'agent' | 'scheduler';
export interface PublicationChallenge {
    readonly challengeId: string;
    readonly owner: VerificationOwner;
    readonly fullTupleHash: string;
    readonly deadline: PublicationOperationReview['deadline'];
}
export interface PublicationObservation {
    readonly status: 'committed' | 'cancelled' | 'unknown';
    readonly owner: VerificationOwner;
    readonly operationId: string;
    readonly fullTupleHash: string;
    readonly businessRevision: number;
    readonly currentVerification: 'valid' | 'needs_revalidation' | 'unavailable';
}
export interface UnapprovedPublicationRecovery {
    readonly status: 'not_approved' | 'settlement_exists';
    readonly owner: VerificationOwner;
    readonly challengeId: string;
    readonly operationId: string;
    readonly fullTupleHash: string;
}
export type PublicationRequestRecovery = Readonly<{
    status: 'not_prepared';
}> | Readonly<UnapprovedPublicationRecovery & {
    challenge: Readonly<PublicationChallenge>;
}>;
export interface PublishedPayload {
    readonly owner: VerificationOwner;
    readonly businessRevision: number;
    readonly operationId: string;
    readonly fullTupleHash: string;
    readonly payloadHash: string;
    readonly bytes: Buffer;
}
export interface OwnerPublicationObservation {
    readonly owner: VerificationOwner;
    readonly businessRevision: number;
    readonly currentVerification: 'valid' | 'needs_revalidation' | 'unavailable';
    readonly publication: Readonly<{
        status: 'absent';
    }> | Readonly<{
        status: 'committed' | 'cancelled' | 'unknown';
        current: boolean;
        operationId: string;
        fullTupleHash: string;
    }>;
}
export declare function parsePublicationChallenge(raw: unknown, boundOwner: VerificationOwner): Readonly<PublicationChallenge>;
export declare function parsePublicationObservation(raw: unknown, original: Readonly<PublicationChallenge>, boundOwner: VerificationOwner): Readonly<PublicationObservation>;
/** Signed transport client. Results are observations, never local write grants.
 * Only the original prepared object can request its one native approval. */
export declare function createPublicationClient(input: {
    owner: VerificationOwner;
    requestSource: PublicationSource;
    transport: ReturnType<typeof createAuthenticatedControllerClient>['publicationTransport'];
}): Readonly<{
    readPayload: (raw: Readonly<OwnerPublicationObservation>, signal?: AbortSignal) => Promise<Readonly<PublishedPayload>>;
    prepareRequest(requestId: string, signal?: AbortSignal): Promise<Readonly<PublicationChallenge>>;
    lookupRequest(requestId: string, signal?: AbortSignal): Promise<Readonly<{
        state: "absent";
    }> | Readonly<{
        state: "not_prepared";
    }> | Readonly<{
        state: "prepared";
        challenge: Readonly<PublicationChallenge>;
    }>>;
    recoverRequest(requestId: string, signal?: AbortSignal): Promise<PublicationRequestRecovery>;
    recoverUnapproved(record: Readonly<PublicationChallenge>, signal?: AbortSignal): Promise<Readonly<UnapprovedPublicationRecovery>>;
    observe(signal?: AbortSignal): Promise<Readonly<OwnerPublicationObservation>>;
    prepare(signal?: AbortSignal): Promise<Readonly<PublicationChallenge>>;
    approve(ticket: Readonly<PublicationChallenge>, signal?: AbortSignal): Promise<Readonly<PublicationObservation>>;
    recoverExpired(record: Readonly<PublicationChallenge>, signal?: AbortSignal): Promise<Readonly<PublicationObservation>>;
    reconcile(record: Readonly<PublicationChallenge>, signal?: AbortSignal): Promise<Readonly<PublicationObservation>>;
}>;
