import type { CapacityWriteContext, PreparedCapacityCommandFacts } from './capacity-command.js';
import type { Database } from 'better-sqlite3';
import { type createVerificationBlobBudget, type BlobReservationProposal } from './blob-budget.js';
import { type createDockerRunner } from '../isolated-execution/docker-runner.js';
import type { QuiescenceExpectation, PhysicalQuiescenceReceipt, QuiescenceAuthority } from '../isolated-execution/physical-quiescence.js';
export declare function assertExecutionTranscriptStoreDatabase(store: object, database: Database): void;
export declare function assertExecutionTranscriptDeleted(store: object, database: Database, proof: object, allocation: Readonly<BlobReservationProposal>): void;
export interface ExecutionTranscriptManifest {
    version: 1;
    scope: 'isolated-execution';
    ownerKey: string;
    expected: QuiescenceExpectation;
    engine: {
        id: string;
        epoch: number;
        imageId: string;
    };
    exitCode: number;
    complete: boolean;
    truncated: boolean;
    reason?: string;
    stdout: {
        size: number;
        sha256: string;
    };
    stderr: {
        size: number;
        sha256: string;
    };
}
export declare function inspectTranscriptPrepareCommand(command: object, budget: object, database: Database): Readonly<PreparedCapacityCommandFacts> | undefined;
export declare function executeTranscriptPrepareCommand(command: object, context: CapacityWriteContext): boolean;
/** Immutable original single-execution bytes. This is not a whole-task archive
 * and does not turn component fixture ports into installed OS authority. */
export declare function createExecutionTranscriptStore(options: {
    root: string;
    database: Database;
    budget: ReturnType<typeof createVerificationBlobBudget>;
    assertCurrent(): void;
    execution: Pick<ReturnType<typeof createDockerRunner>, 'readOwnerKey' | 'readExecution' | 'readCapturedOutput'>;
    quiescence: Pick<QuiescenceAuthority, 'assertQuiescent'>;
    access: {
        assertRead(manifest: Readonly<ExecutionTranscriptManifest>, authorization: object): void;
        assertDelete(manifest: Readonly<ExecutionTranscriptManifest>, authorization: object): void;
    };
}): Readonly<{
    deletionAuthority: Readonly<{
        assertDeleted(proof: object, allocation: Readonly<BlobReservationProposal>): void;
    }>;
    describeArchive(resourceId: string): {
        resourceId: string;
        state: "prepared" | "ready" | "deleted";
        manifest: Readonly<ExecutionTranscriptManifest>;
    };
    record(input: {
        ownerKey: string;
        expected: QuiescenceExpectation;
        output: object;
        receipt: PhysicalQuiescenceReceipt;
    }): Readonly<{
        resourceId: string;
        manifest: ExecutionTranscriptManifest;
    }>;
    read(resourceId: string, authorization: object): Readonly<{
        manifest: Readonly<ExecutionTranscriptManifest>;
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
