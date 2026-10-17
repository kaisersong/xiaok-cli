import { DesktopTaskObservationStore } from './protected-observation-store.js';
import type { ActiveTaskRef, TaskSnapshot } from './types.js';
export interface TaskSnapshotWriteReceipt {
    readonly opaqueTaskSnapshotWriteReceipt: never;
}
export interface TaskSnapshotWriteFacts {
    readonly taskId: string;
    readonly sessionId: string;
    readonly status: TaskSnapshot['status'];
    readonly sequence: number;
    readonly snapshotDigest: string;
}
export declare function getTaskSnapshotWriteReceipt(receipt: TaskSnapshotWriteReceipt, store: FileTaskSnapshotStore): Readonly<TaskSnapshotWriteFacts>;
export interface TaskSnapshotStoreDiagnostics {
    onWrite?: (operation: 'checkpoint' | 'journal' | 'index', bytes: number) => void;
}
/** Internal delivery continuation only; tracking is of unmodified physical IO. */
export interface TaskSnapshotReadOptions {
    signal: AbortSignal;
    trackPending(raw: Promise<unknown>): void;
}
/**
 * A legacy-readable checkpoint plus an append-only mutation journal.
 *
 * Running tasks append only the event suffix and changed top-level fields.
 * Terminal transitions materialize the complete historical TaskSnapshot so
 * older readers keep seeing completed tasks without understanding journals.
 */
export declare class FileTaskSnapshotStore {
    private readonly rootDir;
    private readonly diagnostics;
    readonly observations: DesktopTaskObservationStore;
    private writerQueue;
    private writerClosed;
    private assertWriterCurrent;
    private indexWriteQueue;
    private readonly taskWriteQueues;
    private readonly cache;
    constructor(rootDir: string, diagnostics?: TaskSnapshotStoreDiagnostics);
    save(snapshot: TaskSnapshot, expectedPrevious?: TaskSnapshot): Promise<void>;
    /** Permanently rejects new writes, then waits for accepted physical IO. */
    closeAndDrain(): Promise<void>;
    private enqueueWrite;
    /** Main-only exact-write receipt; it grants no completion/verification authority. */
    saveWithReceipt(snapshot: TaskSnapshot, expectedPrevious?: TaskSnapshot): Promise<TaskSnapshotWriteReceipt>;
    getActiveTasks(): Promise<ActiveTaskRef[]>;
    /** @deprecated Use getActiveTasks() — kept for backward compat */
    getActiveTask(): Promise<ActiveTaskRef | null>;
    recoverTask(taskId: string, options?: TaskSnapshotReadOptions): Promise<TaskSnapshot | null>;
    /** Read-only legacy ownership check, including terminal tasks absent from the active index. */
    hasThreadHistory(threadId: string): Promise<boolean>;
    /** Main-only confirmation history; caller-supplied task lists are never authority. */
    readPreviousUserTask(threadId: string, currentTaskId: string): Promise<TaskSnapshot | null>;
    clearActiveTask(taskId: string): Promise<void>;
    private readProtection;
    private withProtection;
    private saveSerial;
    private loadSnapshotState;
    private writeCheckpoint;
    private syncIndexForTransition;
    private updateIndex;
    private loadIndex;
    private saveIndex;
    private snapshotDir;
    private snapshotPath;
    private journalPath;
    private indexPath;
    private tempPath;
}
/**
 * Compatibility reader for synchronous call sites that previously parsed the
 * checkpoint JSON directly. New runtime paths should prefer recoverTask().
 */
export declare function recoverTaskSnapshotSync(rootDir: string, taskId: string): TaskSnapshot | null;
/** Narrow facts from captured bytes only. Actual full-source custody, retained
 * history and cross-owner relationships must be checked by the source collector. */
export declare function readCapturedTaskSessions(checkpointRaw: string, journalRaw: string, taskId: string): Readonly<{
    taskId: string;
    sessionIdentities: readonly string[];
}>;
/** Captured declarations only: references remain in their original namespace. */
export declare function readCapturedTaskDeclarations(checkpointRaw: string, journalRaw: string, taskId: string): Readonly<{
    kind: "captured-task-declarations";
    taskId: string;
    sessionIdentities: string[];
    references: import("./captured-task-declarations.js").CapturedTaskReference[];
    contexts: import("./types.js").TaskContextAudit[];
    executionScopes: import("./types.js").TaskExecutionScope[];
    executionScopeDeclarations: {
        path: string;
        scope: import("./types.js").TaskExecutionScope;
    }[];
    multiAgentPreparations: import("./types.js").TaskMultiAgentPreparation[];
    protectedObservationClosures: import("../../ai/runtime/protected-observation-closure.js").ProtectedObservationClosure[];
}>;
