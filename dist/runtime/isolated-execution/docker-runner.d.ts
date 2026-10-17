import type { BlobTransactionWriteContext } from '../verification/blob-transaction-command-dispatch.js';
import { type ExecutionWriteContext } from '../verification/execution-command-dispatch.js';
import type { CapacityWriteContext, PreparedCapacityCommandFacts } from '../verification/capacity-command.js';
import type { Database } from 'better-sqlite3';
import { type createVerificationBlobBudget, type BlobReservationProposal } from '../verification/blob-budget.js';
import { DockerEngineTransport } from './docker-engine-transport.js';
import type { createInputStager } from './staging.js';
import type { ExecutionCommand, HostIssuedMountPlan } from './execution-port.js';
import type { QuiescenceExpectation } from './physical-quiescence.js';
import { type DockerStdinDescriptor } from './docker-request.js';
declare const rawTransactionBrand: unique symbol;
export interface RawReservationTransaction {
    readonly [rawTransactionBrand]: true;
}
export declare function inspectRawReservationCommand(command: object, raw: object, database: Database): boolean;
export declare function executeRawReservationCommand(command: object, context: ExecutionWriteContext): boolean;
export declare function inspectDockerTransactionCommand(command: object, budget: object, database: Database): boolean;
export declare function executeDockerTransactionCommand(command: object, context: BlobTransactionWriteContext): boolean;
export declare function consumeExecutionCommandContext(context: ExecutionWriteContext, raw: object, database: Database, command: object): RawReservationTransaction;
interface ReservationHandoffSource {
    readonly plan: HostIssuedMountPlan;
    readonly ownerKey: string;
    readonly expected: QuiescenceExpectation;
}
/** Only a reservation made by this live private transaction can be attached. */
export declare function readDockerReservationHandoff(transaction: object, database: Database, expected: QuiescenceExpectation): ReservationHandoffSource;
export declare function readDockerCapacityExecution(binding: object, database: Database, allocations: readonly Readonly<BlobReservationProposal>[]): HostIssuedMountPlan;
export declare function assertDockerRunnerDeleted(runner: object, database: Database, proof: object, proposal: Readonly<BlobReservationProposal>): void;
export declare function readDockerArchiveCapacitySource(runner: object, database: Database, expected: QuiescenceExpectation): Readonly<BlobReservationProposal>;
export declare function assertDockerRunnerDatabase(runner: object, database: Database, expectedImageId?: string): void;
type NativeManifest = ReturnType<ReturnType<typeof createInputStager>['getManifest']>;
export interface DockerRunnerStager {
    getManifest(plan: HostIssuedMountPlan): NativeManifest & {
        stdin?: DockerStdinDescriptor;
    };
    readFile(plan: HostIssuedMountPlan, path: string): Buffer;
    readStdin?(plan: HostIssuedMountPlan): Buffer;
}
export declare function inspectDockerPrepareCommand(command: object, budget: object, database: Database): Readonly<PreparedCapacityCommandFacts> | undefined;
export declare function executeDockerPrepareCommand(command: object, context: CapacityWriteContext): boolean;
/** Protected-controller execution machinery. This driver does NOT mint a qualified
 * physical receipt. The installed qualification owner must inspect these exact
 * records and engine facts; development transports/test doubles cannot qualify it. */
export declare function createDockerRunner(options: {
    database: Database;
    budget: ReturnType<typeof createVerificationBlobBudget>;
    engine: DockerEngineTransport;
    engineBinding: {
        engineId: string;
        incarnation: string;
        epoch: number;
    };
    imageId: string;
    assertCurrent(): void;
    stager: DockerRunnerStager;
    outputBytes: number;
}): Readonly<{
    reserveCommand(command: object): void;
    commitPreparedCommand(prepared: object, blobContext: BlobTransactionWriteContext): void;
    deletionAuthority: Readonly<{
        assertDeleted(proof: object, proposal: Readonly<BlobReservationProposal>): void;
    }>;
    reserveExecution(input: {
        ownerKey: string;
        sessionIdentity: string;
        compoundOperationId: string;
        validationInvocationId: string;
        scopeDigest: string;
        command: ExecutionCommand;
        materializedInput: HostIssuedMountPlan;
    }, transaction?: RawReservationTransaction): Readonly<{
        executionIdentity: string;
        expected: QuiescenceExpectation;
    }>;
    /** Private rollback cleanup: never releases durable resources or creates a terminal fact. */
    discardUncommittedExecution(expectedInput: QuiescenceExpectation): void;
    readExecution(expected: QuiescenceExpectation): import("./execution-journal.js").ExecutionRecord;
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
export {};
