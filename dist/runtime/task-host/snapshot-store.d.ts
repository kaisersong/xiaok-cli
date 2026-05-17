import type { ActiveTaskRef, TaskSnapshot } from './types.js';
export declare class FileTaskSnapshotStore {
    private readonly rootDir;
    constructor(rootDir: string);
    save(snapshot: TaskSnapshot): Promise<void>;
    getActiveTasks(): Promise<ActiveTaskRef[]>;
    /** @deprecated Use getActiveTasks() — kept for backward compat */
    getActiveTask(): Promise<ActiveTaskRef | null>;
    recoverTask(taskId: string): Promise<TaskSnapshot | null>;
    clearActiveTask(taskId: string): Promise<void>;
    private loadIndex;
    private saveIndex;
    private snapshotDir;
    private snapshotPath;
    private indexPath;
}
