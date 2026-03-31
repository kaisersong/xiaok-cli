export type WorktreeCleanupPolicy = 'keep' | 'delete';
export interface WorktreeAllocationRecord {
    branch: string;
    path: string;
    owner: string;
    taskId: string;
    cleanup: WorktreeCleanupPolicy;
    created: boolean;
}
export interface AllocateWorktreeInput {
    owner: string;
    taskId: string;
    branch: string;
    cleanup?: WorktreeCleanupPolicy;
}
export interface WorktreeManagerOptions {
    repoRoot: string;
    worktreesDir: string;
    execGit(args: string[]): Promise<string>;
}
export interface WorktreeManager {
    allocate(input: AllocateWorktreeInput): Promise<WorktreeAllocationRecord>;
    release(path: string): Promise<void>;
    validatePath(path: string): string;
}
export declare function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManager;
