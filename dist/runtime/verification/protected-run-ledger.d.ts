import type { CapacityWriteContext, PreparedCapacityCommandFacts } from './capacity-command.js';
import type { Database } from 'better-sqlite3';
import { type createVerificationBlobBudget, type BlobReservationProposal } from './blob-budget.js';
import { type createDockerRunner } from '../isolated-execution/docker-runner.js';
import type { QuiescenceAuthority, QuiescenceExpectation, PhysicalQuiescenceReceipt } from '../isolated-execution/physical-quiescence.js';
import type { ProtectedRunCompletionReceipt, ProtectedRunCompletionExpectation } from './protected-run-types.js';
export declare function readProtectedRunCapacityBinding(binding: object, database: Database): {
    raw: object;
    expected: QuiescenceExpectation;
    allocation: Readonly<BlobReservationProposal>;
};
export declare function assertProtectedRunLedgerDatabase(ledger: object, database: Database): void;
export declare function assertProtectedRunDeleted(ledger: object, database: Database, proof: object, allocation: Readonly<BlobReservationProposal>): void;
export declare function inspectRunPrepareCommand(command: object, budget: object, database: Database): Readonly<PreparedCapacityCommandFacts> | undefined;
export declare function executeRunPrepareCommand(command: object, context: CapacityWriteContext): boolean;
export interface Facts extends ProtectedRunCompletionExpectation {
    ownerKey: string;
    rootInvocation: object;
    exitCode: number;
    archiveBytes: number;
}
export type RunDeletionFacts = Facts | Omit<Facts, 'archiveHash' | 'archiveBytes' | 'exitCode'> & {
    archiveHash: null;
    archiveBytes: null;
    exitCode: null;
};
/** Private producer owner. Installation must provide actual enrollment/read/deletion
 * authority and actual raw/physical ports. This ledger never signs whole-task scope. */
export declare function createProtectedRunLedger(input: {
    root: string;
    database: Database;
    budget: ReturnType<typeof createVerificationBlobBudget>;
    assertCurrent(): void;
    execution: Pick<ReturnType<typeof createDockerRunner>, 'readOwnerKey' | 'readExecution' | 'readCapturedOutput'>;
    quiescence: QuiescenceAuthority;
    access: {
        assertStart(proposal: {
            ownerKey: string;
            rootInvocation: object;
        }, authorization: object): void;
        assertRead(facts: Readonly<Facts>, authorization: object): void;
        assertDelete(facts: Readonly<RunDeletionFacts>, authorization: object): void;
    };
}): Readonly<{
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
            expected: QuiescenceExpectation;
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
    hasExecution(expected: QuiescenceExpectation): boolean;
    registerExecution(cap: object, expectedInput: QuiescenceExpectation): void;
    /** Private rollback of an unpublished run. Never infers physical termination. */
    cancelUnstartedRun(cap: object): void;
    endProducer(cap: object): void;
    seal(cap: object): void;
    recordActualExecution(raw: {
        expected: QuiescenceExpectation;
        output: object;
        receipt: PhysicalQuiescenceReceipt;
    }): void;
    recordCancelledExecution(raw: {
        expected: QuiescenceExpectation;
        receipt: PhysicalQuiescenceReceipt;
    }): void;
    /** Recovery of the sole never-started execution; never recreates a producer capability. */
    sealCancelledPreparedRun(input: {
        sourceRunId: string;
        expected: QuiescenceExpectation;
        receipt: PhysicalQuiescenceReceipt;
    }): void;
    complete(sourceRunId: string): Promise<Readonly<{
        receipt: ProtectedRunCompletionReceipt;
        ownerKey: string;
        rootInvocation: object;
        exitCode: number;
        archiveBytes: number;
        sourceRunId: string;
        runNonce: string;
        archiveHash: string;
        scope: import("./protected-run-types.js").ProtectedRunScope;
    }>>;
    describeSource(expected: Readonly<ProtectedRunCompletionExpectation>, authorization: object): Facts;
    readOriginalSource(expected: Readonly<ProtectedRunCompletionExpectation>, authorization: object, limits: {
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
        assertDeleted(proof: object, allocation: Readonly<BlobReservationProposal>): void;
    }>;
    /** A sealed run with no archive allocation can retire body rows, not mint completeness. */
    deleteSealedObservations(sourceRunId: string, context: {
        requestSource: "user" | "agent" | "scheduler";
        authorization: object;
    }): void;
    deleteSource(expected: Readonly<ProtectedRunCompletionExpectation>, context: {
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
    assertComplete(receipt: ProtectedRunCompletionReceipt, expected: Readonly<ProtectedRunCompletionExpectation>): void;
}>;
