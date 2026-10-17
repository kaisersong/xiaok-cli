import type { TaskEventRecord, TaskRuntimeHost, TaskSnapshot } from '../task-host/types.js';
/** One filesystem hint owner; authoritative facts remain native snapshot files. */
export declare class ActivityTaskSnapshotReader {
    private readonly root;
    private generation;
    private readonly waiters;
    private readonly watchers;
    constructor(root: string);
    snapshot(taskId: string): Promise<TaskSnapshot | null>;
    host(): TaskRuntimeHost;
    records(taskId: string, options?: {
        sinceIndex?: number;
        signal?: AbortSignal;
    }): AsyncIterable<TaskEventRecord>;
    close(): void;
}
/** Reads the original native journal. It never claims executor boot ownership. */
export declare class ActivityNativeGroupReader {
    private readonly db;
    constructor(file: string);
    groupThread(groupId: string): string | null;
    events(groupId: string, after: number): any[];
    members(runId: string): any[];
    close(): void;
}
