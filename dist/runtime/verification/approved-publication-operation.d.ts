import type { Database } from 'better-sqlite3';
import { type createVerificationCompletionComposition } from './completion-composition.js';
import { type createApprovedVerificationOperations } from './approved-verification-operation.js';
import type { createReceiverTransport } from './receiver-transport.js';
import type { ControllerPeer } from './controller-public-daemon.js';
import type { ReceiverClockEvidence } from './receiver-store.js';
import type { VerificationOwner } from './proof-authority.js';
import type { Identity } from './receiver-authentication.js';
import { type PublicationOperationReview } from './publication-operation-review.js';
import type { authorizePublicationOperation } from './publication-operation-authorization.js';
type Principal = ControllerPeer & {
    accountGeneration: string;
    source: 'macos-local-generateduid';
};
/** Sole private publication coordinator. Parsed data and native receipts alone
 * cannot substitute the real same-DB proof, immutable payload and receiver journal. */
export declare function createApprovedPublicationOperations(input: {
    database: Database;
    authorityId: string;
    completion: ReturnType<typeof createVerificationCompletionComposition>;
    verification: Pick<ReturnType<typeof createApprovedVerificationOperations>, 'stageVerifiedPayload'>;
    receiverIdentity: Identity;
    receiver: Pick<ReturnType<typeof createReceiverTransport>, 'stagePayload' | 'call'>;
    clock(): ReceiverClockEvidence;
    assertCurrent(): void;
    resolvePrincipal(peer: ControllerPeer): Principal;
    approve(review: Readonly<PublicationOperationReview>, signal: AbortSignal): ReturnType<typeof authorizePublicationOperation>;
}): Readonly<{
    observeIntentCompletion(raw: unknown, p: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        subject: Readonly<import("./intent-host-subject.js").IntentHostSubject>;
        owner: {
            readonly profileId: string;
            readonly ownerKind: "intent";
            readonly ownerId: string;
        };
        contractHash: string;
        registrationHash: string;
        clock: Readonly<ReceiverClockEvidence>;
        publications: readonly Readonly<{
            owner: Readonly<{
                readonly profileId: string;
                readonly ownerKind: "intent";
                readonly ownerId: string;
            }>;
            operationId: string;
            fullTupleHash: string;
            businessRevision: number;
            receiverId: string;
            receiverProtocolVersion: 1;
            receiverInstanceEpoch: number;
            immutablePayloadHash: string;
            bindingHash: string;
            applicationRevision: number;
            candidateRevision: number;
            registrationHash: string;
        }>[];
        scope?: "self-and-dependencies" | undefined;
    }>>;
    observeIntentDependencies(raw: unknown, p: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        subject: Readonly<import("./intent-host-subject.js").IntentHostSubject>;
        owner: {
            readonly profileId: string;
            readonly ownerKind: "intent";
            readonly ownerId: string;
        };
        contractHash: string;
        registrationHash: string;
        clock: Readonly<ReceiverClockEvidence>;
        publications: readonly Readonly<{
            owner: Readonly<{
                readonly profileId: string;
                readonly ownerKind: "intent";
                readonly ownerId: string;
            }>;
            operationId: string;
            fullTupleHash: string;
            businessRevision: number;
            receiverId: string;
            receiverProtocolVersion: 1;
            receiverInstanceEpoch: number;
            immutablePayloadHash: string;
            bindingHash: string;
            applicationRevision: number;
            candidateRevision: number;
            registrationHash: string;
        }>[];
        scope?: "self-and-dependencies" | undefined;
    }>>;
    observeLoopSet(raw: unknown, p: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        clock: Readonly<ReceiverClockEvidence>;
        publications: readonly Readonly<{
            owner: Readonly<VerificationOwner>;
            businessRevision: number;
            operationId: string;
            fullTupleHash: string;
            application: Readonly<import("./business-application-binding.js").ActiveBusinessApplicationBinding>;
        }>[];
    }>>;
    prepare: (raw: unknown, p: ControllerPeer) => Readonly<{
        challengeId: string;
        owner: VerificationOwner;
        fullTupleHash: string;
        deadline: {
            domainId: string;
            qualificationEpoch: number;
            notBefore: number;
            validUntil: number;
        };
    }>;
    prepareRequest: (raw: unknown, rawPeer: ControllerPeer) => Readonly<{
        challengeId: string;
        owner: VerificationOwner;
        fullTupleHash: string;
        deadline: {
            domainId: string;
            qualificationEpoch: number;
            notBefore: number;
            validUntil: number;
        };
    }>;
    lookupRequest: (raw: unknown, rawPeer: ControllerPeer) => Readonly<{
        state: "not_prepared";
    }> | Readonly<{
        state: "absent";
    }> | Readonly<{
        state: "prepared";
        challenge: Readonly<{
            challengeId: string;
            owner: VerificationOwner;
            fullTupleHash: string;
            deadline: {
                domainId: string;
                qualificationEpoch: number;
                notBefore: number;
                validUntil: number;
            };
        }>;
    }>;
    recoverRequest: (raw: unknown, rawPeer: ControllerPeer) => Readonly<{
        status: "not_prepared";
    }> | Readonly<{
        challenge: Readonly<{
            challengeId: string;
            owner: VerificationOwner;
            fullTupleHash: string;
            deadline: {
                domainId: string;
                qualificationEpoch: number;
                notBefore: number;
                validUntil: number;
            };
        }>;
        owner: VerificationOwner;
        challengeId: string;
        operationId: string;
        fullTupleHash: string;
        status: "settlement_exists";
    } | {
        challenge: Readonly<{
            challengeId: string;
            owner: VerificationOwner;
            fullTupleHash: string;
            deadline: {
                domainId: string;
                qualificationEpoch: number;
                notBefore: number;
                validUntil: number;
            };
        }>;
        owner: VerificationOwner;
        challengeId: string;
        operationId: string;
        fullTupleHash: string;
        status: "not_approved";
    }>;
    recoverUnapproved: (raw: unknown, rawPeer: ControllerPeer) => Readonly<{
        owner: VerificationOwner;
        challengeId: string;
        operationId: string;
        fullTupleHash: string;
        status: "settlement_exists";
    }> | Readonly<{
        owner: VerificationOwner;
        challengeId: string;
        operationId: string;
        fullTupleHash: string;
        status: "not_approved";
    }>;
    readOwnerPayload(raw: unknown, p: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        owner: Readonly<VerificationOwner>;
        businessRevision: number;
        operationId: string;
        fullTupleHash: string;
        payloadHash: string;
        totalBytes: number;
        offset: any;
        bytes: string;
        eof: boolean;
    }>>;
    observeOwner(raw: unknown, p: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        owner: Readonly<VerificationOwner>;
        businessRevision: number;
        currentVerification: "unavailable" | "valid" | "needs_revalidation";
        publication: Readonly<{
            status: "absent";
        }>;
    }> | Readonly<{
        owner: Readonly<VerificationOwner>;
        businessRevision: number;
        currentVerification: "unavailable" | "valid" | "needs_revalidation";
        publication: Readonly<{
            status: "unknown" | "cancelled" | "committed";
            current: boolean;
            operationId: string;
            fullTupleHash: string;
        }>;
    }>>;
    recoverExpired(raw: unknown, p: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        status: "unknown" | "cancelled" | "committed";
        owner: VerificationOwner;
        operationId: string;
        fullTupleHash: string;
        businessRevision: number;
        currentVerification: "unavailable" | "valid" | "needs_revalidation";
    }>>;
    approve(raw: unknown, p: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        status: "unknown" | "cancelled" | "committed";
        owner: VerificationOwner;
        operationId: string;
        fullTupleHash: string;
        businessRevision: number;
        currentVerification: "unavailable" | "valid" | "needs_revalidation";
    }>>;
    reconcile(raw: unknown, p: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        status: "unknown" | "cancelled" | "committed";
        owner: VerificationOwner;
        operationId: string;
        fullTupleHash: string;
        businessRevision: number;
        currentVerification: "unavailable" | "valid" | "needs_revalidation";
    }>>;
    close(): Promise<void>;
}>;
export {};
