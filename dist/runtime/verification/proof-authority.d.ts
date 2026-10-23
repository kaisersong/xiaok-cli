import { type IntentContractRegistrationObservation } from './intent-contract-enrollment.js';
import { type BusinessApplicationBinding, type BusinessApplicationObservation } from './business-application-binding.js';
import type { RecipeBinding } from './independent-recipes.js';
import { type KeyObject } from 'node:crypto';
import type { PhysicalQuiescenceReceipt, QuiescenceExpectation, QuiescenceAuthority } from '../isolated-execution/physical-quiescence.js';
import type { Database } from 'better-sqlite3';
import { type VerificationDependency, type VerificationTuple } from './protocol.js';
import type { AuthenticatedReceiverReply, createReceiverReplyVerifier } from './receiver-authentication.js';
import type { ReceiverClockEvidence } from './receiver-store.js';
export interface VerificationOwner {
    profileId: string;
    ownerKind: VerificationTuple['ownerKind'];
    ownerId: string;
}
export interface MandatoryObligation {
    obligationId: string;
    predicateId: string;
    predicateVersion: string;
    semantics: 'current-subject' | 'specific-run' | 'cumulative';
    definitionHash: string;
    requiredCheckIds: readonly string[];
}
export interface VerificationMutationContext {
    requestSource: 'user' | 'agent' | 'scheduler';
    authorization: object;
}
export interface AttemptProposal {
    owner: VerificationOwner;
    obligationId: string;
    expectedAttemptEpoch: number;
    sourceRunId: string;
    runNonce: string;
    subjectId: string;
    contentRoot: string;
    requiredScopeId: string;
    scopeRevision: number;
}
export interface ControllerCore {
    coreId: string;
    coreFinalRevision: number;
    exitCode: number | null;
    quiescent: boolean;
    outputHashes: readonly string[];
}
export interface ControllerVerdict {
    verifierHash: string;
    checks: readonly {
        id: string;
        passed: boolean;
    }[];
    validUntil: number;
}
/** System-controller composition root only. Neither `host` nor its issuance methods may be registered as RPC.
 * Instantiating this database never qualifies its OS identity, staging, runner or verifier recipes.
 */
export declare function createVerificationAuthority(input: {
    root: string;
    /** Host composition only: share the exact private SQLite connection with ACL and outbox. */
    database?: Database;
    receiverVerifier: ReturnType<typeof createReceiverReplyVerifier>;
    issuerId: string;
    verifierHash: string;
    keyId: string;
    serviceEpoch: string;
    privateKey: KeyObject;
    clock: () => ReceiverClockEvidence;
    assertQualified: () => void;
    /** Private exact-connection payload store. Missing composition always denies publication. */
    assertVerifiedPayload?: (tuple: Readonly<VerificationTuple>) => void;
    quiescence: Pick<QuiescenceAuthority, 'assertQuiescent'>;
}): Readonly<{
    service: Readonly<{
        registerOwnerDependency(raw: {
            owner: VerificationOwner;
            child: VerificationOwner;
        }, context: VerificationMutationContext): void;
        registerObligations(raw: {
            owner: VerificationOwner;
            migrationEpoch: number;
            obligations: readonly MandatoryObligation[];
        }, context: VerificationMutationContext): void;
        requestVerification(raw: AttemptProposal, context: VerificationMutationContext): Readonly<{
            attemptId: string;
            attemptEpoch: number;
        }>;
        inspectOwner(owner: VerificationOwner): Readonly<{
            migrationEpoch: number;
            businessRevision: number;
            obligationSetRevision: number;
            obligationSetHash: string;
            obligationCount: number;
            currentVerification: "unavailable" | "valid" | "needs_revalidation";
        }> | undefined;
        getCurrentDependencies(owner: VerificationOwner): VerificationDependency[];
        prepareSettlement(raw: VerificationTuple, context: VerificationMutationContext): void;
        authorizePublication(raw: VerificationTuple, context: VerificationMutationContext): void;
        invalidate(raw: {
            owner: VerificationOwner;
            reason: string;
        }, context: VerificationMutationContext): "pending" | "invalidated";
        close(): void;
    }>;
    host: Readonly<{
        /** Original tuple current check for the private payload composition.
         * No public route, mutation authorization or receiver ticket is created. */
        assertPublicationTuplesCurrent(raw: readonly VerificationTuple[]): void;
        /** Private same-clock observation only. Neither a complete Loop inventory,
         * a payload verification, nor a business mutation capability. */
        /** Transaction-local read composed only after actual enrollment read and
         * before its existing full registration fence. No public owner-list API. */
        inspectIntentPublicationDependencies(raw: {
            registration: Readonly<IntentContractRegistrationObservation>;
            tuples: readonly VerificationTuple[];
        }): Readonly<{
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
        }>;
        inspectIntentPublicationCompletion(raw: {
            registration: Readonly<IntentContractRegistrationObservation>;
            tuples: readonly VerificationTuple[];
        }): Readonly<{
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
        }>;
        inspectLoopPublicationSet(raw: readonly VerificationTuple[]): Readonly<{
            clock: Readonly<ReceiverClockEvidence>;
            publications: readonly Readonly<{
                owner: Readonly<VerificationOwner>;
                businessRevision: number;
                operationId: string;
                fullTupleHash: string;
                application: Readonly<import("./business-application-binding.js").ActiveBusinessApplicationBinding>;
            }>[];
        }>;
        inspectApplication(raw: VerificationOwner): BusinessApplicationObservation;
        beginApplicationTransition(raw: {
            owner: VerificationOwner;
            transitionId: string;
            previousBindingHash: string | null;
            binding: Readonly<BusinessApplicationBinding>;
            registrationHash: string;
        }): void;
        finishApplicationTransition(raw: VerificationOwner, transitionId: string, assertNativeCurrent: () => void): BusinessApplicationObservation;
        /** Denial-only source lifecycle check; expiration never retires an active obligation. */
        assertAttemptsUnreferenced(raw: readonly string[]): void;
        /** Additional private denial predicate; durable requirement survives restart. */
        registerScopeGuard(raw: {
            owner: VerificationOwner;
            scopeId: string;
            revision: number;
        }, guard: object): void;
        /** Current private recipe input facts, never a physical receipt or a public grant. */
        readAdmittedAttempt(raw: RecipeBinding): Readonly<{
            owner: Readonly<VerificationOwner>;
            migrationEpoch: number;
            obligation: Readonly<{
                requiredCheckIds: readonly string[];
                obligationId: string;
                predicateId: string;
                predicateVersion: string;
                semantics: "current-subject" | "specific-run" | "cumulative";
                definitionHash: string;
            }>;
            attemptId: string;
            attemptEpoch: number;
            subjectId: string;
            contentRoot: string;
            sourceRunId: string;
            runNonce: string;
            requiredScopeId: string;
            scopeRevision: number;
            expected: Readonly<{
                sessionIdentity: string;
                compoundOperationId: string;
                validationInvocationId: string;
                executionIdentity: string;
                scopeDigest: string;
            }>;
        }>;
        /** No physical execution exists: bind and this cancellation use the same CAS domain. */
        cancelPreparedAttempt(attemptId: string): void;
        getPendingInvalidationPublications(owner: VerificationOwner): Readonly<VerificationTuple>[];
        issueReceiverChallenge(tuple: VerificationTuple): Readonly<{
            fullTupleHash: string;
            challenge: string;
        }>;
        acceptReceiverReply(raw: VerificationTuple, reply: AuthenticatedReceiverReply): void;
        issueAuthorization(raw: {
            owner: VerificationOwner;
            method: string;
            payload: unknown;
            requestSource: VerificationMutationContext["requestSource"];
            principalId: string;
            expiresAt: number;
        }): object;
        registerSubject(raw: Parameters<(raw: {
            owner: VerificationOwner;
            requiredScopeId: string;
            scopeRevision: number;
            scopeExpiresAt: number;
            manifest: readonly {
                path: string;
                sha256: string;
                size: number;
                role: string;
            }[];
        }, reuseCurrent: boolean) => Readonly<{
            subjectId: string;
            contentRoot: string;
        }>>[0]): Readonly<{
            subjectId: string;
            contentRoot: string;
        }>;
        /** Fresh native admission may share only the exact current immutable subject.
         * Each attempt retains its own scope and proof lifetime. Historical subjects are never revived. */
        admitCurrentSubject(raw: Parameters<(raw: {
            owner: VerificationOwner;
            requiredScopeId: string;
            scopeRevision: number;
            scopeExpiresAt: number;
            manifest: readonly {
                path: string;
                sha256: string;
                size: number;
                role: string;
            }[];
        }, reuseCurrent: boolean) => Readonly<{
            subjectId: string;
            contentRoot: string;
        }>>[0]): Readonly<{
            subjectId: string;
            contentRoot: string;
        }>;
        /** Installed host only, after fresh native material approval and original-byte verification.
         * Refreshes admission for an immutable old version; never revives its proofs. */
        refreshOriginalSubject(raw: {
            owner: VerificationOwner;
            subjectId: string;
            manifest: readonly {
                path: string;
                sha256: string;
                size: number;
                role: string;
            }[];
            requiredScopeId: string;
            scopeRevision: number;
            scopeExpiresAt: number;
        }): Readonly<{
            subjectId: string;
            contentRoot: string;
        }>;
        bindExecution(attemptId: string, raw: QuiescenceExpectation): void;
        /** Only the protected runner/independent recipe composition owns this port; never accept it from JSON/RPC. */
        recordControllerResult(attemptId: string, rawCore: ControllerCore, rawVerdict: ControllerVerdict, receipt?: PhysicalQuiescenceReceipt): void;
    }>;
}>;
