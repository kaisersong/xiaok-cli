import type { Database } from 'better-sqlite3';
import { createCompletionBoundary, type CompletionKernelPeer } from './completion-boundary.js';
import { createOwnerEnrollmentAuthority } from './owner-enrollment-authority.js';
import { createIndependentVerifierRecipes, type RecipeBinding } from './independent-recipes.js';
import { type CompletionMethod } from './completion-transport.js';
export declare function assertVerificationCompletionCompositionDatabase(value: object, database: Database): void;
export declare function assertVerificationCompletionDatabase(host: object, database: Database, verifierHash?: string): void;
type BoundaryOptions = Parameters<typeof createCompletionBoundary>[0];
type EnrollmentOptions = Parameters<typeof createOwnerEnrollmentAuthority>[0];
type RecipeOptions = Parameters<typeof createIndependentVerifierRecipes>[0];
/** Private installed-controller composition. Ports must be the installed owners;
 * dependency injection in tests never establishes OS qualification. Only `public`
 * may be registered on the authenticated controller dispatcher. */
export declare function createVerificationCompletionComposition(input: {
    root: string;
    database: Database;
    authorityId: string;
    authority: Omit<BoundaryOptions['authority'], 'assertVerifiedPayload'>;
    enrollment: Pick<EnrollmentOptions, 'resolvePrincipal' | 'approve' | 'profilePublication' | 'kswarmCapability'>;
    recipePorts: Pick<RecipeOptions, 'assertCurrent' | 'readArtifact' | 'runBlackbox' | 'readFailedRun' | 'assertFailedRunComplete'>;
}): Readonly<{
    public: Readonly<{
        invoke(method: CompletionMethod, raw: unknown, peer: CompletionKernelPeer, signal?: AbortSignal): unknown;
    }>;
    privateHost: Readonly<{
        assertSourceDeletionUnreferenced: (rawOwner: import("./proof-authority.js").VerificationOwner, rawResource: Readonly<import("./archive-operation-review.js").ArchiveResourceReview>) => void;
        readApprovedRecipeBinding(binding: RecipeBinding): Readonly<{
            attempt: Readonly<{
                owner: Readonly<import("./proof-authority.js").VerificationOwner>;
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
            recipe: import("./independent-recipes.js").IndependentRecipeSpec;
        }>;
        authorityHost: Omit<Readonly<{
            assertPublicationTuplesCurrent(raw: readonly import("./protocol.js").VerificationTuple[]): void;
            inspectIntentPublicationDependencies(raw: {
                registration: Readonly<import("./intent-contract-enrollment.js").IntentContractRegistrationObservation>;
                tuples: readonly import("./protocol.js").VerificationTuple[];
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
                tuples: readonly import("./protocol.js").VerificationTuple[];
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
            inspectLoopPublicationSet(raw: readonly import("./protocol.js").VerificationTuple[]): Readonly<{
                clock: Readonly<import("./receiver-store.js").ReceiverClockEvidence>;
                publications: readonly Readonly<{
                    owner: Readonly<import("./proof-authority.js").VerificationOwner>;
                    businessRevision: number;
                    operationId: string;
                    fullTupleHash: string;
                    application: Readonly<import("./business-application-binding.js").ActiveBusinessApplicationBinding>;
                }>[];
            }>;
            inspectApplication(raw: import("./proof-authority.js").VerificationOwner): import("./business-application-binding.js").BusinessApplicationObservation;
            beginApplicationTransition(raw: {
                owner: import("./proof-authority.js").VerificationOwner;
                transitionId: string;
                previousBindingHash: string | null;
                binding: Readonly<import("./business-application-binding.js").BusinessApplicationBinding>;
                registrationHash: string;
            }): void;
            finishApplicationTransition(raw: import("./proof-authority.js").VerificationOwner, transitionId: string, assertNativeCurrent: () => void): import("./business-application-binding.js").BusinessApplicationObservation;
            assertAttemptsUnreferenced(raw: readonly string[]): void;
            registerScopeGuard(raw: {
                owner: import("./proof-authority.js").VerificationOwner;
                scopeId: string;
                revision: number;
            }, guard: object): void;
            readAdmittedAttempt(raw: RecipeBinding): Readonly<{
                owner: Readonly<import("./proof-authority.js").VerificationOwner>;
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
            getPendingInvalidationPublications(owner: import("./proof-authority.js").VerificationOwner): Readonly<import("./protocol.js").VerificationTuple>[];
            issueReceiverChallenge(tuple: import("./protocol.js").VerificationTuple): Readonly<{
                fullTupleHash: string;
                challenge: string;
            }>;
            acceptReceiverReply(raw: import("./protocol.js").VerificationTuple, reply: import("./receiver-authentication.js").AuthenticatedReceiverReply): void;
            issueAuthorization(raw: {
                owner: import("./proof-authority.js").VerificationOwner;
                method: string;
                payload: unknown;
                requestSource: import("./proof-authority.js").VerificationMutationContext["requestSource"];
                principalId: string;
                expiresAt: number;
            }): object;
            registerSubject(raw: Parameters<(raw: {
                owner: import("./proof-authority.js").VerificationOwner;
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
                owner: import("./proof-authority.js").VerificationOwner;
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
                owner: import("./proof-authority.js").VerificationOwner;
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
        }>, "close">;
        authorityService: Omit<Readonly<{
            registerOwnerDependency(raw: {
                owner: import("./proof-authority.js").VerificationOwner;
                child: import("./proof-authority.js").VerificationOwner;
            }, context: import("./proof-authority.js").VerificationMutationContext): void;
            registerObligations(raw: {
                owner: import("./proof-authority.js").VerificationOwner;
                migrationEpoch: number;
                obligations: readonly import("./proof-authority.js").MandatoryObligation[];
            }, context: import("./proof-authority.js").VerificationMutationContext): void;
            requestVerification(raw: import("./proof-authority.js").AttemptProposal, context: import("./proof-authority.js").VerificationMutationContext): Readonly<{
                attemptId: string;
                attemptEpoch: number;
            }>;
            inspectOwner(owner: import("./proof-authority.js").VerificationOwner): Readonly<{
                migrationEpoch: number;
                businessRevision: number;
                obligationSetRevision: number;
                obligationSetHash: string;
                obligationCount: number;
                currentVerification: "unavailable" | "valid" | "needs_revalidation";
            }> | undefined;
            getCurrentDependencies(owner: import("./proof-authority.js").VerificationOwner): import("./protocol.js").VerificationDependency[];
            prepareSettlement(raw: import("./protocol.js").VerificationTuple, context: import("./proof-authority.js").VerificationMutationContext): void;
            authorizePublication(raw: import("./protocol.js").VerificationTuple, context: import("./proof-authority.js").VerificationMutationContext): void;
            invalidate(raw: {
                owner: import("./proof-authority.js").VerificationOwner;
                reason: string;
            }, context: import("./proof-authority.js").VerificationMutationContext): "pending" | "invalidated";
            close(): void;
        }>, "close">;
        completionScopes: Omit<Readonly<{
            assertDatabaseConnection(connection: Database): void;
            issueReadScope(raw: {
                owner: import("./proof-authority.js").VerificationOwner;
                peer: CompletionKernelPeer;
                expiresAt: number;
            }): Readonly<{
                id: string;
                secret: string;
            }>;
            issueMutation(raw: {
                owner: import("./proof-authority.js").VerificationOwner;
                peer: CompletionKernelPeer;
                expiresAt: number;
                method: "completion.settle" | "completion.authorize";
                tuple: import("./protocol.js").VerificationTuple;
                requestSource: "user" | "agent" | "scheduler";
            }): Readonly<{
                id: string;
                secret: string;
            }>;
            revokeOwnerPrincipal(raw: {
                owner: import("./proof-authority.js").VerificationOwner;
                peer: CompletionKernelPeer;
            }): void;
        }>, "close">;
        enrollment: Omit<Readonly<{
            getLiveSourceRegistrationReviews(): ReadonlyArray<Readonly<import("./owner-enrollment-review.js").OwnerEnrollmentReview>>;
            prepare(raw: {
                enrollment: import("./profile-owner-registry.js").OwnerEnrollment;
                registration: import("./owner-enrollment-review.js").OwnerEnrollmentReview["registration"];
            }, rawPeer: import("./controller-public-daemon.js").ControllerPeer): Readonly<{
                challengeId: `${string}-${string}-${string}-${string}-${string}`;
                canonicalReview: Readonly<import("./owner-enrollment-review.js").OwnerEnrollmentReview>;
            }>;
            prepareRequest(raw: import("./owner-enrollment-request.js").OwnerEnrollmentRequest, rawPeer: import("./controller-public-daemon.js").ControllerPeer): Readonly<{
                created: false;
                challenge: import("./owner-enrollment-request.js").OwnerEnrollmentChallenge;
            }> | Readonly<{
                created: true;
                challenge: Readonly<{
                    challengeId: `${string}-${string}-${string}-${string}-${string}`;
                    canonicalReview: Readonly<import("./owner-enrollment-review.js").OwnerEnrollmentReview>;
                }>;
            }>;
            lookupRequest(raw: import("./owner-enrollment-request.js").OwnerEnrollmentRequest, rawPeer: import("./controller-public-daemon.js").ControllerPeer): import("./owner-enrollment-request.js").OwnerEnrollmentRequestObservation;
            recoverRequest(raw: import("./owner-enrollment-request.js").OwnerEnrollmentRequest, rawPeer: import("./controller-public-daemon.js").ControllerPeer): import("./owner-enrollment-request.js").OwnerEnrollmentRequestRecovery;
            authorize(id: string, rawPeer: import("./controller-public-daemon.js").ControllerPeer, signal: AbortSignal): Promise<Readonly<{
                owner: Readonly<import("./proof-authority.js").VerificationOwner>;
                readGrant: ReturnType<(raw: {
                    owner: import("./proof-authority.js").VerificationOwner;
                    peer: CompletionKernelPeer;
                    expiresAt: number;
                }) => Readonly<{
                    id: string;
                    secret: string;
                }>>;
            }>>;
            openOwner(raw: {
                ownerKind: import("./profile-owner-registry.js").OwnerEnrollment["ownerKind"];
                ownerId: string;
            }, rawPeer: import("./controller-public-daemon.js").ControllerPeer): Readonly<{
                owner: Readonly<import("./proof-authority.js").VerificationOwner>;
                readGrant: Readonly<{
                    id: string;
                    secret: string;
                }>;
            }>;
            readApplicationRegistration(raw: import("./proof-authority.js").VerificationOwner, rawPeer: import("./controller-public-daemon.js").ControllerPeer, sessionId: string): Readonly<{
                owner: Readonly<import("./proof-authority.js").VerificationOwner>;
                registrationHash: string;
            }>;
            readLoopApplicationRegistration(raw: import("./proof-authority.js").VerificationOwner, rawPeer: import("./controller-public-daemon.js").ControllerPeer, rawSubject: Readonly<import("./loop-host-subject.js").LoopHostSubject>): Readonly<{
                owner: Readonly<import("./proof-authority.js").VerificationOwner>;
                subject: Readonly<import("./loop-host-subject.js").LoopHostSubject>;
                registrationHash: string;
            }>;
            readKSwarmApplicationRegistration(raw: import("./proof-authority.js").VerificationOwner, rawPeer: import("./controller-public-daemon.js").ControllerPeer, rawSubject: Readonly<import("./kswarm-host-subject.js").KSwarmHostSubject>): Readonly<{
                owner: Readonly<import("./proof-authority.js").VerificationOwner>;
                subject: Readonly<import("./kswarm-host-subject.js").KSwarmHostSubject>;
                registrationHash: string;
            }>;
            captureRegistrationReadFence(owner: import("./proof-authority.js").VerificationOwner): () => void;
            readIntentApplicationRegistration(raw: import("./proof-authority.js").VerificationOwner, rawPeer: import("./controller-public-daemon.js").ControllerPeer, rawSubject: Readonly<import("./intent-host-subject.js").IntentHostSubject>): Readonly<{
                owner: Readonly<import("./proof-authority.js").VerificationOwner & {
                    ownerKind: "intent";
                }>;
                subject: Readonly<import("./intent-host-subject.js").IntentHostSubject>;
                contract: Readonly<import("./intent-business-contract.js").IntentBusinessContract>;
                contractHash: string;
                registrationHash: string;
            }>;
            readIntentRegistration(raw: unknown, rawPeer: import("./controller-public-daemon.js").ControllerPeer): Readonly<{
                owner: Readonly<import("./proof-authority.js").VerificationOwner & {
                    ownerKind: "intent";
                }>;
                subject: Readonly<import("./intent-host-subject.js").IntentHostSubject>;
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
            }>;
            readIntentContract(raw: unknown, rawPeer: import("./controller-public-daemon.js").ControllerPeer): Readonly<{
                owner: Readonly<import("./proof-authority.js").VerificationOwner & {
                    ownerKind: "intent";
                }>;
                subject: Readonly<import("./intent-host-subject.js").IntentHostSubject>;
                contract: Readonly<import("./intent-business-contract.js").IntentBusinessContract>;
                contractHash: string;
                registrationHash: string;
            }>;
            readGoalForkSource(raw: {
                ownerKind: "goal";
                ownerId: string;
                sessionId: string;
            }, rawPeer: import("./controller-public-daemon.js").ControllerPeer): Readonly<import("./owner-enrollment-review.js").GoalForkSourceSnapshot>;
            readApprovedRecipe(raw: import("./proof-authority.js").VerificationOwner, obligationId: string): import("./independent-recipes.js").IndependentRecipeSpec;
            resolveOwnerKey: (rawPeer: import("./controller-public-daemon.js").ControllerPeer, rawInvocation: import("./product-material-authorization.js").ValidationMaterialInvocation) => string;
            getProfile: (rawPeer: import("./controller-public-daemon.js").ControllerPeer) => Readonly<import("./profile-owner-registry.js").PublicProfileIndex>;
            createCapacityOwnerBinding: (rawPeer: import("./controller-public-daemon.js").ControllerPeer, rawInvocation: import("./product-material-authorization.js").ValidationMaterialInvocation) => object;
            close(): void;
        }>, "close">;
        recipes: Omit<Readonly<{
            compile(raw: import("./independent-recipes.js").IndependentRecipeSpec): import("./independent-recipes.js").IndependentRecipePlan;
            evaluate(plan: import("./independent-recipes.js").IndependentRecipePlan, rawBinding: RecipeBinding): Promise<import("./independent-recipes.js").RecipeEvaluation>;
            exportVerifiedArtifacts(evaluation: import("./independent-recipes.js").RecipeEvaluation): import("./independent-recipes.js").VerifiedRecipeArtifacts;
        }>, "close">;
        payloads: Omit<Readonly<{
            prepareRetention: (evaluation: import("./independent-recipes.js").RecipeEvaluation) => Readonly<{
                token: Readonly<{}>;
                bundleHash: string;
            }>;
            commitRetention: (token: object) => void;
            stage(raw: {
                owner: import("./proof-authority.js").VerificationOwner;
                evaluations: readonly import("./independent-recipes.js").RecipeEvaluation[];
            }): Readonly<{
                payloadId: string;
                immutablePayloadHash: string;
                byteLength: number;
            }>;
            stageRetained(owner: import("./proof-authority.js").VerificationOwner): Readonly<{
                payloadId: string;
                immutablePayloadHash: string;
                byteLength: number;
            }>;
            capture(payloadId: string, rawOwner: import("./proof-authority.js").VerificationOwner): Readonly<{
                readBytes: () => Buffer<ArrayBuffer>;
                assertCurrent: () => void;
            }>;
            read(payloadId: string, rawOwner: import("./proof-authority.js").VerificationOwner): Buffer;
            assertTuple(raw: import("./protocol.js").VerificationTuple): void;
        }>, "close">;
    }>;
    close(): void;
}>;
export {};
