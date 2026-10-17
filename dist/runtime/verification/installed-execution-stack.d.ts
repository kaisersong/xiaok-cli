import { type createInstalledSharedCapacity } from './installed-shared-capacity.js';
import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { createInstalledRootBrokerClient } from './root-broker-client.js';
import type { ControllerPeer } from './controller-public-daemon.js';
import type { ValidationMaterialInvocation } from './product-material-authorization.js';
export declare function assertInstalledStackCapacityComponent(ticket: object, owner: object, slot: string, component: object, engine?: object): void;
export declare function assertInstalledExecutionStack(value: object, lifetime: Readonly<InstalledControllerLifetime>): void;
/** Fixed installed stack, not a factory for caller-provided engines or keys.
 * Entry must provide actual same-authority ACL implementations and close public
 * admission before closing its lifetime. No default authorization callbacks. */
export declare function createInstalledExecutionStack(input: {
    assembly: object;
    lifetime: Readonly<InstalledControllerLifetime>;
    sharedCapacity: ReturnType<typeof createInstalledSharedCapacity>;
    broker: ReturnType<typeof createInstalledRootBrokerClient>;
    signal?: AbortSignal;
}): Promise<Readonly<{
    publicPort: Readonly<{
        invoke(method: string, payload: unknown, peer: ControllerPeer, callerSignal: AbortSignal): Promise<import("./material-request.js").MaterialRequestObservation | Readonly<{
            challengeId: string;
            canonicalReview: import("./product-material-authorization.js").ValidationMaterialReview;
        }> | import("./product-material-authorization.js").PrivateMaterialHandle | Readonly<{
            mountPlanHandle: {
                id: `${string}-${string}-${string}-${string}-${string}`;
                secret: string;
            };
            command: {
                argv: string[];
                cwdRelative: string;
            };
            scopeDigest: string;
            invocation: ValidationMaterialInvocation;
        }> | {
            expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
            engineId: string;
            engineEpoch: string;
            quiescent: boolean;
        } | {
            executionHandle: {
                id: `${string}-${string}-${string}-${string}-${string}`;
                secret: string;
            };
            executionIdentity: string;
            expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
            exitCode?: undefined;
            termination?: undefined;
            outputTruncated?: undefined;
            stdout?: undefined;
            stderr?: undefined;
            physical?: undefined;
        } | {
            expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
            exitCode: number;
            termination: string;
            outputTruncated: boolean;
            stdout: string;
            stderr: string;
            physical: {
                expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                engineId: string;
                engineEpoch: string;
                quiescent: boolean;
            };
        } | {
            authorityId: string;
            serviceEpoch: string;
            deploymentPackageHash: string;
            qualificationId: string;
            engineBinding: Readonly<{
                engineId: string;
                incarnation: string;
            }>;
            isolationPolicyHash: string;
            validUntil: number;
            clock: Readonly<{
                domainId: string;
                qualificationEpoch: number;
                evidenceHash: string;
            }>;
            evidenceHashes: Readonly<{
                osIdentity: string;
                engineInspection: string;
                escapeSuite: string;
            }>;
        }>;
    }>;
    privateHost: Readonly<{
        materialCleanup: Readonly<{
            assertCleanup: (resourceId: string) => void;
            sweepOnce: () => Promise<void>;
            startMaintenance(): void;
            getStatus(): Readonly<{
                started: boolean;
                running: boolean;
                lastOutcome: "deleted" | "idle" | "deferred";
                lastError: string | undefined;
            }>;
            cleanupResource(resourceId: string, signal?: AbortSignal): Promise<void>;
            close(): Promise<void>;
        }>;
        engine: Readonly<{
            observation: Readonly<import("./engine-bootstrap-journal.js").EngineBootstrapObservation>;
            hostSocket: string;
            imageDigest: string;
            assertCurrent: () => void;
            inspect: () => Promise<{
                engineId: string;
                machineId: string;
                bootId: string;
                effectiveConfigHash: string;
                creationNonce: string;
                processUid: number;
                processStartIdentity: string;
            }>;
            qualified: false;
        }>;
        broker: Readonly<{
            authorizeProfileSources(input: {
                requestSource: "user" | "agent" | "scheduler";
                review: unknown;
            }, signal?: AbortSignal): Promise<Readonly<import("./profile-source-authorization.js").ProfileSourceApprovalReceipt>>;
            captureProfileSources(receipt: Readonly<import("./profile-source-authorization.js").ProfileSourceApprovalReceipt>, signal?: AbortSignal): Promise<Readonly<{}>>;
            describeProfileCapture(handle: object): Readonly<{
                review: Readonly<import("./profile-source-review.js").ProfileSourceReview>;
                manifestHash: string;
                manifestBytes: number;
                capturedBytes: number;
            }>;
            readProfileManifest(handle: object, offset: number, length: number, signal?: AbortSignal): Promise<Buffer<ArrayBuffer>>;
            loadProfileCaptureManifest(handle: object, signal?: AbortSignal): Promise<Readonly<import("./profile-capture-transfer.js").ProfileCaptureTransfer>>;
            readProfileFile(handle: object, sourceId: string, entryIndex: number, offset: number, length: number, signal?: AbortSignal): Promise<Buffer<ArrayBuffer>>;
            readProfileSqlitePage(handle: object, sourceId: string, pageNo: number, signal?: AbortSignal): Promise<Buffer<ArrayBuffer>>;
            checkProfileCapture(handle: object, signal?: AbortSignal): Promise<void>;
            releaseProfileCapture(handle: object, signal?: AbortSignal): Promise<void>;
            authorizePublicationOperation(raw: unknown, signal?: AbortSignal): Promise<Readonly<{
                version: 1;
                purpose: "completion-publication";
                authorityId: string;
                challengeId: string;
                uid: number;
                accountGeneration: string;
                auditSessionId: number;
                requestSource: "user" | "agent" | "scheduler";
                fullReviewHash: string;
            }>>;
            authorizeApplicationBinding(input: {
                requestSource: "user" | "agent" | "scheduler";
                review: unknown;
            }, signal?: AbortSignal): Promise<{
                uid: number;
                auditSessionId: number;
                reviewHash: string;
            }>;
            authorizeArchiveOperation(input: {
                requestSource: "user" | "agent" | "scheduler";
                review: unknown;
            }, signal?: AbortSignal): Promise<{
                uid: number;
                auditSessionId: number;
                reviewHash: string;
            }>;
            authorizeOwnerEnrollment(raw: unknown, signal?: AbortSignal): Promise<{
                uid: number;
                auditSessionId: number;
                reviewHash: string;
            }>;
            authorizeMaterials(input: {
                uid: number;
                auditSessionId: number;
                review: unknown;
                deadline: Readonly<import("./material-deadline.js").MaterialDeadline>;
            }, signal?: AbortSignal): Promise<{
                uid: number;
                auditSessionId: number;
                reviewHash: string;
            }>;
            inspectMaterial(input: {
                uid: number;
                workspace: string;
                path: string;
                byteLimit: number;
            }, signal?: AbortSignal): Promise<{
                sha256: string;
                size: number;
                executable: boolean;
            }>;
            readMaterialPage(input: {
                uid: number;
                workspace: string;
                path: string;
                byteLimit: number;
                contentHash: string;
                offset: number;
                length: number;
            }, signal?: AbortSignal): Promise<{
                contentHash: string;
                totalBytes: number;
                executable: boolean;
                offset: number;
                bytes: string;
            }>;
            resolvePrincipal(peer: Readonly<{
                uid: number;
                gid: number;
                auditSessionId: number;
            }>): Readonly<{
                uid: number;
                gid: number;
                auditSessionId: number;
                accountGeneration: string;
                source: "macos-local-generateduid";
            }>;
            clock(): Readonly<import("./receiver-store.js").ReceiverClockEvidence>;
            dispose(): void;
        }>;
        budget: Readonly<{
            commitSharedReserveCommand(command: object, sharedContext: object): void;
            usesSharedCapacity: true;
            reserveCommand(command: object): Readonly<{
                token: object;
                created: boolean;
            }>;
            reserveBatchCommand(command: object, transaction?: import("./blob-budget.js").BlobReservationTransaction): readonly Readonly<{
                token: object;
                created: boolean;
            }>[];
            executeTransactionCommand(command: object): void;
            commitSharedWholeCommand(prepared: object, sharedContext: object): void;
            commitSharedBatchCommand(prepared: object, sharedContext: object): void;
            assertExternalOperationBoundary(): void;
            reserve(raw: import("./blob-budget.js").BlobReservationProposal): Readonly<{
                token: object;
                created: boolean;
            }>;
            getState(raw: import("./blob-budget.js").BlobReservationProposal): "reserved" | "released" | undefined;
            assertReserved(token: object, raw: import("./blob-budget.js").BlobReservationProposal): void;
            release(token: object, proof: object): void;
            close(): void;
        }>;
        qualification: Readonly<{
            deletionAuthority: Readonly<{
                assertDeleted(proof: object, proposal: Readonly<import("./blob-budget.js").BlobReservationProposal>): void;
            }>;
            assertCurrent: () => void;
            ensureCurrent(signal?: AbortSignal): Promise<void>;
            currentFacts(): Readonly<{
                qualificationId: string;
                engineBinding: Readonly<{
                    engineId: string;
                    incarnation: string;
                }>;
                isolationPolicyHash: string;
                validUntil: number;
                clock: Readonly<{
                    domainId: string;
                    qualificationEpoch: number;
                    evidenceHash: string;
                }>;
                evidenceHashes: Readonly<{
                    osIdentity: string;
                    engineInspection: string;
                    escapeSuite: string;
                }>;
            }>;
            qualify(signal?: AbortSignal): Promise<Readonly<{
                qualificationId: string;
                engineBinding: {
                    engineId: string;
                    incarnation: string;
                };
                isolationPolicyHash: string;
                evidenceHashes: {
                    osIdentity: string;
                    engineInspection: string;
                    escapeSuite: string;
                };
            }>>;
            close(): void;
        }>;
        materials: Readonly<{
            prepareRequest: (raw: unknown, peerInput: ControllerPeer, signal: AbortSignal) => Promise<import("./material-request.js").MaterialPrepareResult>;
            lookupRequest: (raw: unknown, peerInput: ControllerPeer) => import("./material-request.js").MaterialRequestObservation;
            retireRequest: (raw: unknown, peerInput: ControllerPeer) => import("./material-request.js").MaterialRequestObservation;
            stager: Readonly<{
                deletionAuthority: Readonly<{
                    assertDeleted(proof: object, proposal: Readonly<import("./blob-budget.js").BlobReservationProposal>): void;
                }>;
                deleteResource(resourceId: string): void;
                acceptPlan(plan: import("../isolated-execution/execution-port.js").HostIssuedMountPlan): void;
                discardUnpublishedPlan(plan: import("../isolated-execution/execution-port.js").HostIssuedMountPlan): void;
                prepareValidationInput(input: {
                    grant: object;
                    ownerKey: string;
                    signal: AbortSignal;
                    capacityBinding?: object;
                }): Promise<Readonly<{
                    materializedInput: import("../isolated-execution/execution-port.js").HostIssuedMountPlan;
                    command: {
                        argv: string[];
                        cwdRelative: string;
                    };
                    scopeDigest: string;
                }>>;
                getManifest(plan: import("../isolated-execution/execution-port.js").HostIssuedMountPlan): import("../isolated-execution/broker-staging.js").BrokerStagingManifest;
                readFile(plan: import("../isolated-execution/execution-port.js").HostIssuedMountPlan, path: string): Buffer;
            }>;
            assertScopeInactive: (scopeDigest: string) => void;
            prepare(raw: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
                challengeId: string;
                canonicalReview: import("./product-material-authorization.js").ValidationMaterialReview;
            }>>;
            authorize: (id: string, peerInput: ControllerPeer, signal: AbortSignal) => Promise<import("./product-material-authorization.js").PrivateMaterialHandle>;
            stage: (input: {
                grantHandle: import("./product-material-authorization.js").PrivateMaterialHandle;
                invocation: ValidationMaterialInvocation;
            }, peerInput: ControllerPeer, signal: AbortSignal) => Promise<Readonly<{
                mountPlanHandle: {
                    id: `${string}-${string}-${string}-${string}-${string}`;
                    secret: string;
                };
                command: {
                    argv: string[];
                    cwdRelative: string;
                };
                scopeDigest: string;
                invocation: ValidationMaterialInvocation;
            }>>;
            consumeMountPlan: (handle: import("./product-material-authorization.js").PrivateMaterialHandle, peerInput: ControllerPeer) => Readonly<{
                plan: import("../isolated-execution/execution-port.js").HostIssuedMountPlan;
                review: import("./product-material-authorization.js").ValidationMaterialReview;
                deadline: Readonly<import("./material-deadline.js").MaterialDeadline>;
                handoff: Readonly<{}>;
            }>;
            inspectMountPlanHandoff: (raw: {
                authorizationId: string;
            }, rawPeer: ControllerPeer) => Readonly<import("./material-authority.js").MaterialMountPlanHandoffFacts> | Readonly<{
                state: "unclaimed";
                authorizationId: string;
            }>;
            readMountPlanHandoff: (ticket: object) => Readonly<import("./material-authority.js").MaterialMountPlanHandoffFacts>;
            attachMountPlanHandoff: (ticket: object, transaction: object, expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation) => void;
            revoke: (id: string, peer: ControllerPeer) => void;
        }>;
        execution: Readonly<{
            deletionAuthority: Readonly<{
                assertDeleted(proof: object, proposal: Readonly<import("./blob-budget.js").BlobReservationProposal>): void;
            }>;
            publicPort: Readonly<{
                invoke(method: string, payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<{
                    expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                    engineId: string;
                    engineEpoch: string;
                    quiescent: boolean;
                } | {
                    executionHandle: {
                        id: `${string}-${string}-${string}-${string}-${string}`;
                        secret: string;
                    };
                    executionIdentity: string;
                    expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                    exitCode?: undefined;
                    termination?: undefined;
                    outputTruncated?: undefined;
                    stdout?: undefined;
                    stderr?: undefined;
                    physical?: undefined;
                } | {
                    expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                    exitCode: number;
                    termination: string;
                    outputTruncated: boolean;
                    stdout: string;
                    stderr: string;
                    physical: {
                        expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                        engineId: string;
                        engineEpoch: string;
                        quiescent: boolean;
                    };
                }>;
            }>;
            privateHost: Readonly<{
                raw: Readonly<{
                    reserveCommand(command: object): void;
                    commitPreparedCommand(prepared: object, blobContext: import("./blob-transaction-command-dispatch.js").BlobTransactionWriteContext): void;
                    deletionAuthority: Readonly<{
                        assertDeleted(proof: object, proposal: Readonly<import("./blob-budget.js").BlobReservationProposal>): void;
                    }>;
                    reserveExecution(input: {
                        ownerKey: string;
                        sessionIdentity: string;
                        compoundOperationId: string;
                        validationInvocationId: string;
                        scopeDigest: string;
                        command: import("../isolated-execution/execution-port.js").ExecutionCommand;
                        materializedInput: import("../isolated-execution/execution-port.js").HostIssuedMountPlan;
                    }, transaction?: import("../isolated-execution/docker-runner.js").RawReservationTransaction): Readonly<{
                        executionIdentity: string;
                        expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                    }>;
                    discardUncommittedExecution(expectedInput: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation): void;
                    readExecution(expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation): import("../isolated-execution/execution-journal.js").ExecutionRecord;
                    readOwnerKey(expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation): string;
                    cancelPreparedExecution(expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation): void;
                    inspectCancellationFacts(expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation): Promise<Readonly<{
                        expected: Readonly<import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation>;
                        engineBinding: Readonly<{
                            engineId: string;
                            incarnation: string;
                            epoch: number;
                        }>;
                        cancelledBeforeStart: true;
                    }>>;
                    inspectExecutionFacts(expectedInput: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation): Promise<Readonly<{
                        expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                        containerId: string;
                        engineBinding: Readonly<{
                            engineId: string;
                            incarnation: string;
                            epoch: number;
                        }>;
                        exitCode: number;
                    }>>;
                    dispatchExecution(expectedInput: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation, options?: {
                        signal?: AbortSignal;
                    }): Promise<Readonly<{
                        expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                        exitCode: number;
                        output: Readonly<{}>;
                    }>>;
                    readCapturedOutput(output: object, input: {
                        expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                    }): Readonly<{
                        stdout: Buffer<ArrayBuffer>;
                        stderr: Buffer<ArrayBuffer>;
                        complete: boolean;
                        truncated: boolean;
                        reason?: "deadline" | "aborted" | "transport" | "frame" | "limit" | "stdin";
                    }>;
                    assertOutputDisclosure(output: object, input: {
                        expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                    }): void;
                    readArchive(output: object, path: string, input: {
                        expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                        signal?: AbortSignal;
                        maxBytes?: number;
                    }): Promise<Buffer<ArrayBufferLike>>;
                    cleanupExecution(expectedInput: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation): Promise<void>;
                    close(): void;
                }>;
                quiescence: import("../isolated-execution/physical-quiescence.js").QuiescenceAuthority;
                caseStager: import("./approved-blackbox-stager.js").ApprovedBlackboxStager;
            }>;
            close(): Promise<void>;
        }>;
        transcripts: Readonly<{
            deletionAuthority: Readonly<{
                assertDeleted(proof: object, allocation: Readonly<import("./blob-budget.js").BlobReservationProposal>): void;
            }>;
            describeArchive(resourceId: string): {
                resourceId: string;
                state: "prepared" | "ready" | "deleted";
                manifest: Readonly<import("./execution-transcripts.js").ExecutionTranscriptManifest>;
            };
            record(input: {
                ownerKey: string;
                expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                output: object;
                receipt: import("../isolated-execution/physical-quiescence.js").PhysicalQuiescenceReceipt;
            }): Readonly<{
                resourceId: string;
                manifest: import("./execution-transcripts.js").ExecutionTranscriptManifest;
            }>;
            read(resourceId: string, authorization: object): Readonly<{
                manifest: Readonly<import("./execution-transcripts.js").ExecutionTranscriptManifest>;
                stdout: NonSharedBuffer;
                stderr: NonSharedBuffer;
            }>;
            delete(resourceId: string, context: {
                requestSource: "user" | "agent" | "scheduler";
                authorization: object;
            }): void;
            reconcileDeletedBudget(input: {
                limit: number;
                after?: string;
            }): Readonly<{
                processed: number;
                nextCursor: string | null;
            }>;
            close(): void;
        }>;
        runs: Readonly<{
            describeArchive(sourceRunId: string): {
                sourceRunId: string;
                runNonce: string;
                ownerKey: string;
                rootInvocation: any;
                state: string;
                archiveHash: string | null;
                archiveBytes: number | null;
                memberCount: number;
                censusHash: string;
                members: {
                    expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                    observationHash: string | null;
                }[];
                producers: unknown[];
            };
            beginRun(raw: {
                ownerKey: string;
                rootInvocation: object;
                authorization: object;
            }): Readonly<{
                sourceRunId: `${string}-${string}-${string}-${string}-${string}`;
                runNonce: `${string}-${string}-${string}-${string}-${string}`;
                scope: "protected-execution-run";
                producer: Readonly<{}>;
            }>;
            beginRunInTransaction(raw: {
                ownerKey: string;
                rootInvocation: object;
                authorization: object;
            }): Readonly<{
                sourceRunId: `${string}-${string}-${string}-${string}-${string}`;
                runNonce: `${string}-${string}-${string}-${string}-${string}`;
                scope: "protected-execution-run";
                producer: Readonly<{}>;
            }>;
            discardUncommittedRun(cap: object): void;
            forkProducer(parent: object): Readonly<{}>;
            hasExecution(expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation): boolean;
            registerExecution(cap: object, expectedInput: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation): void;
            cancelUnstartedRun(cap: object): void;
            endProducer(cap: object): void;
            seal(cap: object): void;
            recordActualExecution(raw: {
                expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                output: object;
                receipt: import("../isolated-execution/physical-quiescence.js").PhysicalQuiescenceReceipt;
            }): void;
            recordCancelledExecution(raw: {
                expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                receipt: import("../isolated-execution/physical-quiescence.js").PhysicalQuiescenceReceipt;
            }): void;
            sealCancelledPreparedRun(input: {
                sourceRunId: string;
                expected: import("../isolated-execution/physical-quiescence.js").QuiescenceExpectation;
                receipt: import("../isolated-execution/physical-quiescence.js").PhysicalQuiescenceReceipt;
            }): void;
            complete(sourceRunId: string): Promise<Readonly<{
                receipt: import("./protected-run-types.js").ProtectedRunCompletionReceipt;
                ownerKey: string;
                rootInvocation: object;
                exitCode: number;
                archiveBytes: number;
                sourceRunId: string;
                runNonce: string;
                archiveHash: string;
                scope: import("./protected-run-types.js").ProtectedRunScope;
            }>>;
            describeSource(expected: Readonly<import("./protected-run-types.js").ProtectedRunCompletionExpectation>, authorization: object): import("./protected-run-ledger.js").Facts;
            readOriginalSource(expected: Readonly<import("./protected-run-types.js").ProtectedRunCompletionExpectation>, authorization: object, limits: {
                maxBytes: number;
            }): Readonly<{
                bytes: NonSharedBuffer;
                ownerKey: string;
                rootInvocation: object;
                exitCode: number;
                archiveBytes: number;
                sourceRunId: string;
                runNonce: string;
                archiveHash: string;
                scope: import("./protected-run-types.js").ProtectedRunScope;
            }>;
            deletionAuthority: Readonly<{
                assertDeleted(proof: object, allocation: Readonly<import("./blob-budget.js").BlobReservationProposal>): void;
            }>;
            deleteSealedObservations(sourceRunId: string, context: {
                requestSource: "user" | "agent" | "scheduler";
                authorization: object;
            }): void;
            deleteSource(expected: Readonly<import("./protected-run-types.js").ProtectedRunCompletionExpectation>, context: {
                requestSource: "user" | "agent" | "scheduler";
                authorization: object;
            }): void;
            reconcileDeletedBudget(input: {
                limit: number;
                after?: string;
            }): Readonly<{
                processed: number;
                nextCursor: string | null;
            }>;
            close(): void;
            assertComplete(receipt: import("./protected-run-types.js").ProtectedRunCompletionReceipt, expected: Readonly<import("./protected-run-types.js").ProtectedRunCompletionExpectation>): void;
        }>;
        blackbox: Readonly<{
            commitPreparedCase: (command: object, context: import("./execution-command-dispatch.js").ExecutionWriteContext) => void;
            runBlackbox(request: Parameters<(request: {
                binding: import("./independent-recipes.js").RecipeBinding;
                caseId: string;
                caseInvocationId: string;
                input: Buffer;
            }) => Promise<import("./independent-recipes.js").BlackboxObservation>>[0]): Promise<import("./independent-recipes.js").BlackboxObservation>;
            close(): Promise<void>;
        }>;
    }>;
    close(): Promise<void>;
}>>;
