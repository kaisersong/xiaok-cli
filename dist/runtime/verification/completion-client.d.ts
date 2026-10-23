import { type IntentHostSubject } from './intent-host-subject.js';
import type { OwnerEnrollmentRequest, OwnerEnrollmentRequestObservation, OwnerEnrollmentChallenge } from './owner-enrollment-request.js';
import { type OwnerEnrollmentReview } from './owner-enrollment-review.js';
import type { OwnerEnrollment } from './profile-owner-registry.js';
import { type VerificationTuple } from './protocol.js';
import type { AuthenticatedCompletionTransport } from './completion-transport.js';
import type { VerificationOwner, VerificationMutationContext } from './proof-authority.js';
import type { PrivateMaterialHandle } from './product-material-authorization.js';
export interface CurrentCompletionState {
    owner: VerificationOwner;
    migrationEpoch: number;
    businessRevision: number;
    obligationSetRevision: number;
    obligationSetHash: string;
    obligationCount: number;
    currentVerification: 'valid' | 'needs_revalidation' | 'unavailable';
}
export interface CompletionSettlementResult {
    owner: VerificationOwner;
    operationId: string;
    fullTupleHash: string;
    committedBusinessRevision: number;
    state: 'committed';
}
/** Pure historical response validation only; it issues no read grant or currentness fact. */
export declare function parseCurrentCompletionState(raw: unknown, expectedOwner: Readonly<VerificationOwner>): Readonly<CurrentCompletionState>;
/** Host-bound client for an already protected owner. Reads are fresh observations,
 * never capabilities authorizing a later local success write. The installed signed
 * transport, controller read ACL, migration fencing and receiver remain separate required boundaries.
 */
export declare function createCompletionClient(input: {
    owner: VerificationOwner;
    readGrant: PrivateMaterialHandle;
    transport: AuthenticatedCompletionTransport;
}): Readonly<{
    inspect(signal?: AbortSignal): Promise<Readonly<CurrentCompletionState>>;
    inspectSync(): Readonly<CurrentCompletionState>;
    settle(raw: VerificationTuple, options: {
        authorization: PrivateMaterialHandle;
        requestSource: VerificationMutationContext["requestSource"];
        signal?: AbortSignal;
    }): Promise<Readonly<CompletionSettlementResult>>;
    authorizePublication(raw: VerificationTuple, options: {
        authorization: PrivateMaterialHandle;
        requestSource: VerificationMutationContext["requestSource"];
        signal?: AbortSignal;
    }): Promise<void>;
}>;
/** Native enrollment is explicit and separate from successful completion. This
 * client only binds the signed reply; the installed daemon owns all grants. */
export declare function createOwnerEnrollmentClient(transport: AuthenticatedCompletionTransport): Readonly<{
    readIntentRegistration(raw: {
        subject: IntentHostSubject;
    }, signal?: AbortSignal): Promise<Readonly<{
        owner: Readonly<{
            profileId: string;
            ownerKind: "intent";
            ownerId: string;
        }>;
        subject: Readonly<IntentHostSubject>;
        contractHash: string;
        registration: {
            migrationEpoch: number;
            obligations: readonly {
                obligation: import("./proof-authority.js").MandatoryObligation;
                recipe: import("./independent-recipes.js").IndependentRecipeSpec;
            }[];
            source: {
                kind: "new-owner";
                fork?: import("./owner-enrollment-review.js").GoalForkSource;
            } | {
                kind: "migration";
                sourceSessionId: string;
                sourceStoreRevision: number;
                sourceSnapshotHash: string;
                migrationId: string;
            };
        };
        registrationHash: string;
    }>>;
    readIntentContract(raw: {
        subject: IntentHostSubject;
    }, signal?: AbortSignal): Promise<Readonly<import("./intent-contract-enrollment.js").IntentContractRegistrationObservation>>;
    readGoalForkSource(raw: {
        ownerKind: "goal";
        ownerId: string;
        sessionId: string;
    }, signal?: AbortSignal): Promise<Readonly<import("./owner-enrollment-review.js").GoalForkSourceSnapshot>>;
    prepareRequest(raw: OwnerEnrollmentRequest, signal?: AbortSignal): Promise<Readonly<{
        created: boolean;
        challenge: OwnerEnrollmentChallenge;
    }>>;
    lookupRequest(raw: OwnerEnrollmentRequest, signal?: AbortSignal): Promise<OwnerEnrollmentRequestObservation>;
    recoverRequest(raw: OwnerEnrollmentRequest, signal?: AbortSignal): Promise<Readonly<{
        state: "not_prepared";
    }> | Readonly<{
        state: "not_approved";
        challenge: OwnerEnrollmentChallenge;
    }> | Readonly<{
        state: "committed";
        challenge: OwnerEnrollmentChallenge;
        owner: VerificationOwner;
    }>>;
    prepare(raw: {
        enrollment: OwnerEnrollment;
        registration: OwnerEnrollmentReview["registration"];
    }, signal?: AbortSignal): Promise<Readonly<{
        challengeId: string;
        canonicalReview: Readonly<OwnerEnrollmentReview>;
    }>>;
    authorize(ticket: object, signal?: AbortSignal): Promise<Readonly<{
        owner: VerificationOwner;
        readGrant: PrivateMaterialHandle;
    }>>;
}>;
export declare function openCompletionClient(input: {
    ownerKind: VerificationOwner['ownerKind'];
    ownerId: string;
    transport: AuthenticatedCompletionTransport;
    signal?: AbortSignal;
}): Promise<Readonly<{
    inspect(signal?: AbortSignal): Promise<Readonly<CurrentCompletionState>>;
    inspectSync(): Readonly<CurrentCompletionState>;
    settle(raw: VerificationTuple, options: {
        authorization: PrivateMaterialHandle;
        requestSource: VerificationMutationContext["requestSource"];
        signal?: AbortSignal;
    }): Promise<Readonly<CompletionSettlementResult>>;
    authorizePublication(raw: VerificationTuple, options: {
        authorization: PrivateMaterialHandle;
        requestSource: VerificationMutationContext["requestSource"];
        signal?: AbortSignal;
    }): Promise<void>;
}>>;
export declare function openCompletionClientSync(input: {
    ownerKind: VerificationOwner['ownerKind'];
    ownerId: string;
    transport: AuthenticatedCompletionTransport;
}): Readonly<{
    inspect(signal?: AbortSignal): Promise<Readonly<CurrentCompletionState>>;
    inspectSync(): Readonly<CurrentCompletionState>;
    settle(raw: VerificationTuple, options: {
        authorization: PrivateMaterialHandle;
        requestSource: VerificationMutationContext["requestSource"];
        signal?: AbortSignal;
    }): Promise<Readonly<CompletionSettlementResult>>;
    authorizePublication(raw: VerificationTuple, options: {
        authorization: PrivateMaterialHandle;
        requestSource: VerificationMutationContext["requestSource"];
        signal?: AbortSignal;
    }): Promise<void>;
}>;
