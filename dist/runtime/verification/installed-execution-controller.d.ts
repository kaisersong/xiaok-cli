import type { ExecutionWriteContext } from './execution-command-dispatch.js';
import { createApprovedBlackboxStager } from './approved-blackbox-stager.js';
import type { Database } from 'better-sqlite3';
import { type initializeInstalledMacEngine } from './installed-engine.js';
import { type createInstalledEngineQualification } from './installed-engine-qualification.js';
import type { createVerificationBlobBudget } from './blob-budget.js';
import type { createControllerMaterialPipeline } from './material-pipeline.js';
import type { ControllerPeer } from './controller-public-daemon.js';
import type { ValidationMaterialInvocation } from './product-material-authorization.js';
import { createDockerRunner } from '../isolated-execution/docker-runner.js';
import type { PhysicalQuiescenceReceipt, QuiescenceAuthority, QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
export declare function inspectMaterialExecutionCommand(command: object, raw: object, database: Database): boolean;
export declare function executeMaterialExecutionCommand(command: object, context: ExecutionWriteContext): boolean;
/** Actual installed private composition. No fake engine/qualification callback can
 * reach the receipt issuer; only publicPort is registered on authenticated IPC. */
export declare function createInstalledExecutionController(input: {
    engine: Awaited<ReturnType<typeof initializeInstalledMacEngine>>;
    database: Database;
    qualification: ReturnType<typeof createInstalledEngineQualification>;
    budget: ReturnType<typeof createVerificationBlobBudget>;
    materials: ReturnType<typeof createControllerMaterialPipeline>;
    resolveOwnerKey(peer: ControllerPeer, invocation: ValidationMaterialInvocation): string;
    readApprovedRecipeBinding: Parameters<typeof createApprovedBlackboxStager>[0]['readApprovedRecipeBinding'];
    onActualExecutionResult(input: {
        expected: QuiescenceExpectation;
        output: object;
        receipt: PhysicalQuiescenceReceipt;
    }, raw: ReturnType<typeof createDockerRunner>): void;
}): Readonly<{
    deletionAuthority: Readonly<{
        assertDeleted(proof: object, proposal: Readonly<import("./blob-budget.js").BlobReservationProposal>): void;
    }>;
    publicPort: Readonly<{
        invoke(method: string, payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<{
            expected: QuiescenceExpectation;
            engineId: string;
            engineEpoch: string;
            quiescent: boolean;
        } | {
            executionHandle: {
                id: `${string}-${string}-${string}-${string}-${string}`;
                secret: string;
            };
            executionIdentity: string;
            expected: QuiescenceExpectation;
            exitCode?: undefined;
            termination?: undefined;
            outputTruncated?: undefined;
            stdout?: undefined;
            stderr?: undefined;
            physical?: undefined;
        } | {
            expected: QuiescenceExpectation;
            exitCode: number;
            termination: string;
            outputTruncated: boolean;
            stdout: string;
            stderr: string;
            physical: {
                expected: QuiescenceExpectation;
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
                expected: QuiescenceExpectation;
            }>;
            discardUncommittedExecution(expectedInput: QuiescenceExpectation): void;
            readExecution(expected: QuiescenceExpectation): import("../isolated-execution/execution-journal.js").ExecutionRecord;
            readOwnerKey(expected: QuiescenceExpectation): string;
            cancelPreparedExecution(expected: QuiescenceExpectation): void;
            inspectCancellationFacts(expected: QuiescenceExpectation): Promise<Readonly<{
                expected: Readonly<QuiescenceExpectation>;
                engineBinding: Readonly<{
                    engineId: string;
                    incarnation: string;
                    epoch: number;
                }>;
                cancelledBeforeStart: true;
            }>>;
            inspectExecutionFacts(expectedInput: QuiescenceExpectation): Promise<Readonly<{
                expected: QuiescenceExpectation;
                containerId: string;
                engineBinding: Readonly<{
                    engineId: string;
                    incarnation: string;
                    epoch: number;
                }>;
                exitCode: number;
            }>>;
            dispatchExecution(expectedInput: QuiescenceExpectation, options?: {
                signal?: AbortSignal;
            }): Promise<Readonly<{
                expected: QuiescenceExpectation;
                exitCode: number;
                output: Readonly<{}>;
            }>>;
            readCapturedOutput(output: object, input: {
                expected: QuiescenceExpectation;
            }): Readonly<{
                stdout: Buffer<ArrayBuffer>;
                stderr: Buffer<ArrayBuffer>;
                complete: boolean;
                truncated: boolean;
                reason?: "deadline" | "aborted" | "transport" | "frame" | "limit" | "stdin";
            }>;
            assertOutputDisclosure(output: object, input: {
                expected: QuiescenceExpectation;
            }): void;
            readArchive(output: object, path: string, input: {
                expected: QuiescenceExpectation;
                signal?: AbortSignal;
                maxBytes?: number;
            }): Promise<Buffer<ArrayBufferLike>>;
            cleanupExecution(expectedInput: QuiescenceExpectation): Promise<void>;
            close(): void;
        }>;
        quiescence: QuiescenceAuthority;
        caseStager: import("./approved-blackbox-stager.js").ApprovedBlackboxStager;
    }>;
    close(): Promise<void>;
}>;
