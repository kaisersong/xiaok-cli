import type { ActiveTaskRef, TaskSnapshot } from './types.js';
export interface TaskSnapshotStoreDiagnostics {
    onWrite?: (operation: 'checkpoint' | 'journal' | 'index', bytes: number) => void;
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
    private indexWriteQueue;
    private readonly taskWriteQueues;
    private readonly cache;
    constructor(rootDir: string, diagnostics?: TaskSnapshotStoreDiagnostics);
    save(snapshot: TaskSnapshot, expectedPrevious?: TaskSnapshot): Promise<void>;
    getActiveTasks(): Promise<ActiveTaskRef[]>;
    /** @deprecated Use getActiveTasks() — kept for backward compat */
    getActiveTask(): Promise<ActiveTaskRef | null>;
    recoverTask(taskId: string): Promise<TaskSnapshot | null>;
    clearActiveTask(taskId: string): Promise<void>;
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
