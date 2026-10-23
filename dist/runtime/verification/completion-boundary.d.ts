import type { Database } from 'better-sqlite3';
import { createVerificationAuthority, type VerificationOwner } from './proof-authority.js';
import { type VerificationTuple } from './protocol.js';
import type { CompletionMethod } from './completion-transport.js';
export interface CompletionKernelPeer {
    uid: number;
    gid: number;
    auditSessionId: number;
}
type Source = 'user' | 'agent' | 'scheduler';
type AuthorityOptions = Omit<Parameters<typeof createVerificationAuthority>[0], 'root' | 'database'>;
/** Installed controller composition only. host issuance requires the broker's native
 * authorization before calling; none of host or authority is a public RPC handler.
 * A kernel peer is supplied exclusively by the accepted socket, never request JSON.
 */
export declare function createCompletionBoundary(input: {
    root: string;
    authority: AuthorityOptions;
    database?: Database;
}): Readonly<{
    authority: Readonly<{
        service: Readonly<{
            registerOwnerDependency(raw: {
                owner: VerificationOwner;
                child: VerificationOwner;
            }, context: import("./proof-authority.js").VerificationMutationContext): void;
            registerObligations(raw: {
                owner: VerificationOwner;
                migrationEpoch: number;
                obligations: readonly import("./proof-authority.js").MandatoryObligation[];
            }, context: import("./proof-authority.js").VerificationMutationContext): void;
            requestVerification(raw: import("./proof-authority.js").AttemptProposal, context: import("./proof-authority.js").VerificationMutationContext): Readonly<{
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
            getCurrentDependencies(owner: VerificationOwner): import("./protocol.js").VerificationDependency[];
            prepareSettlement(raw: VerificationTuple, context: import("./proof-authority.js").VerificationMutationContext): void;
            authorizePublication(raw: VerificationTuple, context: import("./proof-authority.js").VerificationMutationContext): void;
            invalidate(raw: {
                owner: VerificationOwner;
                reason: string;
            }, context: import("./proof-authority.js").VerificationMutationContext): "pending" | "invalidated";
            close(): void;
        }>;
        host: Readonly<{
            assertPublicationTuplesCurrent(raw: readonly VerificationTuple[]): void;
            inspectIntentPublicationDependencies(raw: {
                registration: Readonly<import("./intent-contract-enrollment.js").IntentContractRegistrationObservation>;
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
                clock: Readonly<import("./receiver-store.js").ReceiverClockEvidence>;
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
                registration: Readonly<import("./intent-contract-enrollment.js").IntentContractRegistrationObservation>;
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
                clock: Readonly<import("./receiver-store.js").ReceiverClockEvidence>;
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
                clock: Readonly<import("./receiver-store.js").ReceiverClockEvidence>;
                publications: readonly Readonly<{
                    owner: Readonly<VerificationOwner>;
                    businessRevision: number;
                    operationId: string;
                    fullTupleHash: string;
                    application: Readonly<import("./business-application-binding.js").ActiveBusinessApplicationBinding>;
                }>[];
            }>;
            inspectApplication(raw: VerificationOwner): import("./business-application-binding.js").BusinessApplicationObservation;
            beginApplicationTransition(raw: {
                owner: VerificationOwner;
                transitionId: string;
                previousBindingHash: string | null;
                binding: Readonly<import("./business-application-binding.js").BusinessApplicationBinding>;
                registrationHash: string;
            }): void;
            finishApplicationTransition(raw: VerificationOwner, transitionId: string, assertNativeCurrent: () => void): import("./business-application-binding.js").BusinessApplicationObservation;
            assertAttemptsUnreferenced(raw: readonly string[]): void;
            registerScopeGuard(raw: {
                owner: VerificationOwner;
                scopeId: string;
                revision: number;
            }, guard: object): void;
            readAdmittedAttempt(raw: import("./independent-recipes.js").RecipeBinding): Readonly<{
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
            cancelPreparedAttempt(attemptId: string): void;
            getPendingInvalidationPublications(owner: VerificationOwner): Readonly<VerificationTuple>[];
            issueReceiverChallenge(tuple: VerificationTuple): Readonly<{
                fullTupleHash: string;
                challenge: string;
            }>;
            acceptReceiverReply(raw: VerificationTuple, reply: import("./receiver-authentication.js").AuthenticatedReceiverReply): void;
            issueAuthorization(raw: {
                owner: VerificationOwner;
                method: string;
                payload: unknown;
                requestSource: import("./proof-authority.js").VerificationMutationContext["requestSource"];
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
            bindExecution(attemptId: string, raw: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation): void;
            recordControllerResult(attemptId: string, rawCore: import("./proof-authority.js").ControllerCore, rawVerdict: import("./proof-authority.js").ControllerVerdict, receipt?: import("../isolated-execution/physical-quiescence.js").PhysicalQuiescenceReceipt): void;
        }>;
    }>;
    host: Readonly<{
        assertDatabaseConnection(connection: Database): void;
        issueReadScope(raw: {
            owner: VerificationOwner;
            peer: CompletionKernelPeer;
            expiresAt: number;
        }): Readonly<{
            id: string;
            secret: string;
        }>;
        issueMutation(raw: {
            owner: VerificationOwner;
            peer: CompletionKernelPeer;
            expiresAt: number;
            method: "completion.settle" | "completion.authorize";
            tuple: VerificationTuple;
            requestSource: Source;
        }): Readonly<{
            id: string;
            secret: string;
        }>;
        revokeOwnerPrincipal(raw: {
            owner: VerificationOwner;
            peer: CompletionKernelPeer;
        }): void;
    }>;
    invoke(method: CompletionMethod, raw: unknown, kernelPeer: CompletionKernelPeer): unknown;
    close(): void;
}>;
export {};
