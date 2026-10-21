import { type KSwarmHostSubject } from './kswarm-host-subject.js';
import type { OwnerEnrollmentRequest, OwnerEnrollmentRequestObservation, OwnerEnrollmentRequestRecovery, OwnerEnrollmentChallenge } from './owner-enrollment-request.js';
import type { Database } from 'better-sqlite3';
import type { ControllerPeer } from './controller-public-daemon.js';
import type { createCompletionBoundary } from './completion-boundary.js';
import { type PublicProfileIndex, type OwnerEnrollment } from './profile-owner-registry.js';
import { type OwnerEnrollmentReview } from './owner-enrollment-review.js';
import type { ReceiverClockEvidence } from './receiver-store.js';
import type { VerificationOwner, MandatoryObligation } from './proof-authority.js';
import { type IntentHostSubject } from './intent-host-subject.js';
import { type LoopHostSubject } from './loop-host-subject.js';
interface Principal extends ControllerPeer {
    accountGeneration: string;
    source: 'macos-local-generateduid';
}
/** Private installed composition. Actual broker/native ports remain required.
 * This controller creates no proof of successful execution and is not OS qualification. */
export declare function createOwnerEnrollmentAuthority(input: {
    kswarmCapability?: object;
    database: Database;
    authorityId: string;
    completion: ReturnType<typeof createCompletionBoundary>;
    clock(): ReceiverClockEvidence;
    resolvePrincipal(peer: ControllerPeer): Principal;
    approve(review: Readonly<OwnerEnrollmentReview>, signal: AbortSignal): Promise<{
        uid: number;
        auditSessionId: number;
        reviewHash: string;
    }>;
    profilePublication: {
        publish(index: Readonly<PublicProfileIndex>): void;
        assertPublished(index: Readonly<PublicProfileIndex>): void;
    };
}): Readonly<{
    /** Private read-only inventory: expiry is judged by this authorizer's original clock. */
    getLiveSourceRegistrationReviews(): ReadonlyArray<Readonly<OwnerEnrollmentReview>>;
    prepare(raw: {
        enrollment: OwnerEnrollment;
        registration: OwnerEnrollmentReview["registration"];
    }, rawPeer: ControllerPeer): Readonly<{
        challengeId: `${string}-${string}-${string}-${string}-${string}`;
        canonicalReview: Readonly<OwnerEnrollmentReview>;
    }>;
    prepareRequest(raw: OwnerEnrollmentRequest, rawPeer: ControllerPeer): Readonly<{
        created: false;
        challenge: OwnerEnrollmentChallenge;
    }> | Readonly<{
        created: true;
        challenge: Readonly<{
            challengeId: `${string}-${string}-${string}-${string}-${string}`;
            canonicalReview: Readonly<OwnerEnrollmentReview>;
        }>;
    }>;
    lookupRequest(raw: OwnerEnrollmentRequest, rawPeer: ControllerPeer): OwnerEnrollmentRequestObservation;
    recoverRequest(raw: OwnerEnrollmentRequest, rawPeer: ControllerPeer): OwnerEnrollmentRequestRecovery;
    authorize(id: string, rawPeer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        owner: Readonly<VerificationOwner>;
        readGrant: ReturnType<(raw: {
            owner: VerificationOwner;
            peer: import("./completion-boundary.js").CompletionKernelPeer;
            expiresAt: number;
        }) => Readonly<{
            id: string;
            secret: string;
        }>>;
    }>>;
    openOwner(raw: {
        ownerKind: OwnerEnrollment["ownerKind"];
        ownerId: string;
    }, rawPeer: ControllerPeer): Readonly<{
        owner: Readonly<VerificationOwner>;
        readGrant: Readonly<{
            id: string;
            secret: string;
        }>;
    }>;
    /** Private recipe lookup. A parsed definition or a partial enrollment is not approval. */
    readApplicationRegistration(raw: VerificationOwner, rawPeer: ControllerPeer, sessionId: string): Readonly<{
        owner: Readonly<VerificationOwner>;
        registrationHash: string;
    }>;
    readLoopApplicationRegistration(raw: VerificationOwner, rawPeer: ControllerPeer, rawSubject: Readonly<LoopHostSubject>): Readonly<{
        owner: Readonly<VerificationOwner>;
        subject: Readonly<LoopHostSubject>;
        registrationHash: string;
    }>;
    readKSwarmApplicationRegistration(raw: VerificationOwner, rawPeer: ControllerPeer, rawSubject: Readonly<KSwarmHostSubject>): Readonly<{
        owner: Readonly<VerificationOwner>;
        subject: Readonly<KSwarmHostSubject>;
        registrationHash: string;
    }>;
    captureRegistrationReadFence(owner: VerificationOwner): () => void;
    readIntentApplicationRegistration(raw: VerificationOwner, rawPeer: ControllerPeer, rawSubject: Readonly<IntentHostSubject>): Readonly<{
        owner: Readonly<VerificationOwner & {
            ownerKind: "intent";
        }>;
        subject: Readonly<IntentHostSubject>;
        contract: Readonly<import("./intent-business-contract.js").IntentBusinessContract>;
        contractHash: string;
        registrationHash: string;
    }>;
    readIntentRegistration(raw: unknown, rawPeer: ControllerPeer): Readonly<{
        owner: Readonly<VerificationOwner & {
            ownerKind: "intent";
        }>;
        subject: Readonly<IntentHostSubject>;
        contractHash: string;
        registration: {
            migrationEpoch: number;
            obligations: readonly {
                obligation: MandatoryObligation;
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
    }>;
    readIntentContract(raw: unknown, rawPeer: ControllerPeer): Readonly<{
        owner: Readonly<VerificationOwner & {
            ownerKind: "intent";
        }>;
        subject: Readonly<IntentHostSubject>;
        contract: Readonly<import("./intent-business-contract.js").IntentBusinessContract>;
        contractHash: string;
        registrationHash: string;
    }>;
    readGoalForkSource(raw: {
        ownerKind: "goal";
        ownerId: string;
        sessionId: string;
    }, rawPeer: ControllerPeer): Readonly<import("./owner-enrollment-review.js").GoalForkSourceSnapshot>;
    readApprovedRecipe(raw: VerificationOwner, obligationId: string): import("./independent-recipes.js").IndependentRecipeSpec;
    resolveOwnerKey: (rawPeer: ControllerPeer, rawInvocation: import("./product-material-authorization.js").ValidationMaterialInvocation) => string;
    getProfile: (rawPeer: ControllerPeer) => Readonly<PublicProfileIndex>;
    createCapacityOwnerBinding: (rawPeer: ControllerPeer, rawInvocation: import("./product-material-authorization.js").ValidationMaterialInvocation) => object;
    close(): void;
}>;
export {};
