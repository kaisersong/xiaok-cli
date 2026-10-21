import type { Database } from 'better-sqlite3';
import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { type MaintenanceEngineAttachment } from './maintenance-engine-attachment.js';
import { type createInstalledSharedCapacity } from './installed-shared-capacity.js';
import type { QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
import type { BlobReservationProposal } from './blob-budget.js';
declare const receiptBrand: unique symbol;
export interface MaintenanceQuiescenceReceipt {
    readonly [receiptBrand]: true;
}
export declare function readMaintenanceExecution(value: object, database: Database): Readonly<{
    disposeUnstarted(): void;
    assertCurrent: () => void;
    raw: Readonly<{
        reserveCommand(command: object): void;
        commitPreparedCommand(prepared: object, blobContext: import("./blob-transaction-command-dispatch.js").BlobTransactionWriteContext): void;
        deletionAuthority: Readonly<{
            assertDeleted(proof: object, proposal: Readonly<BlobReservationProposal>): void;
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
    inventory: () => {
        hash: string;
        expected: QuiescenceExpectation[];
    };
    ensureCurrent: () => Promise<void>;
    inspectExecution(rawExpected: QuiescenceExpectation): Promise<MaintenanceQuiescenceReceipt>;
    assertQuiescent: (receipt: object, expected: QuiescenceExpectation) => void;
    cleanupExecution(rawExpected: QuiescenceExpectation): Promise<MaintenanceQuiescenceReceipt>;
    deletionAuthority: Readonly<{
        assertDeleted(proof: object, proposal: Readonly<BlobReservationProposal>): void;
    }>;
    close(): Promise<void>;
}>;
export declare function assertMaintenanceProbeDeleted(value: object, database: Database, proof: object, proposal: Readonly<BlobReservationProposal>): void;
declare function build(input: {
    lifetime: InstalledControllerLifetime;
    attachment: MaintenanceEngineAttachment;
    sharedCapacity: ReturnType<typeof createInstalledSharedCapacity>;
}): Readonly<{
    disposeUnstarted(): void;
    assertCurrent: () => void;
    raw: Readonly<{
        reserveCommand(command: object): void;
        commitPreparedCommand(prepared: object, blobContext: import("./blob-transaction-command-dispatch.js").BlobTransactionWriteContext): void;
        deletionAuthority: Readonly<{
            assertDeleted(proof: object, proposal: Readonly<BlobReservationProposal>): void;
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
    inventory: () => {
        hash: string;
        expected: QuiescenceExpectation[];
    };
    ensureCurrent: () => Promise<void>;
    inspectExecution(rawExpected: QuiescenceExpectation): Promise<MaintenanceQuiescenceReceipt>;
    assertQuiescent: (receipt: object, expected: QuiescenceExpectation) => void;
    cleanupExecution(rawExpected: QuiescenceExpectation): Promise<MaintenanceQuiescenceReceipt>;
    deletionAuthority: Readonly<{
        assertDeleted(proof: object, proposal: Readonly<BlobReservationProposal>): void;
    }>;
    close(): Promise<void>;
}>;
export declare function createInstalledMaintenanceExecution(input: Parameters<typeof build>[0]): Readonly<{
    inspectExecution: (rawExpected: QuiescenceExpectation) => Promise<MaintenanceQuiescenceReceipt>;
    cleanupExecution: (rawExpected: QuiescenceExpectation) => Promise<MaintenanceQuiescenceReceipt>;
    assertQuiescent: (receipt: object, expected: QuiescenceExpectation) => void;
    close: () => Promise<void>;
    deletionAuthority: Readonly<{
        assertDeleted(proof: object, proposal: Readonly<BlobReservationProposal>): void;
    }>;
}>;
export {};
