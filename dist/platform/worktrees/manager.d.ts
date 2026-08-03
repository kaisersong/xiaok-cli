export type WorktreeCleanupPolicy = 'keep' | 'delete';
export type WorktreeLeaseState = 'allocating' | 'active' | 'released' | 'orphaned';
export type PathUsage = 'used' | 'free' | 'unknown';
export interface ProcessIdentity {
    pid: number;
    startedAt: string | null;
    cwd: string;
}
export interface ProcessInspection {
    status: 'same' | 'missing' | 'mismatch' | 'unknown';
    startedAt?: string | null;
    cwd?: string;
}
export interface WorktreeAllocationRecord {
    branch: string;
    path: string;
    owner: string;
    taskId: string;
    cleanup: WorktreeCleanupPolicy;
    created: boolean;
}
export interface WorktreeLeaseRecord {
    branch: string;
    path: string;
    owner: string;
    taskId: string;
    cleanup: WorktreeCleanupPolicy;
    state: WorktreeLeaseState;
    allocator: ProcessIdentity;
    createdAt: number;
    updatedAt: number;
    lastError?: string;
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
    getCurrentProcessIdentity?(): Promise<ProcessIdentity>;
    inspectProcess?(identity: ProcessIdentity): Promise<ProcessInspection>;
    inspectPathUsage?(path: string): Promise<PathUsage>;
    now?(): number;
    registryPath?: string;
}
export interface WorktreeReconcileResult {
    changed: string[];
    skipped: Array<{
        branch: string;
        reason: string;
    }>;
}
export interface WorktreeGcResult {
    dryRun: boolean;
    candidates: string[];
    removed: string[];
    skipped: Array<{
        branch: string;
        reason: string;
    }>;
}
export interface WorktreeManager {
    allocate(input: AllocateWorktreeInput): Promise<WorktreeAllocationRecord>;
    release(path: string): Promise<void>;
    reconcile(): Promise<WorktreeReconcileResult>;
    gc(options?: {
        dryRun?: boolean;
    }): Promise<WorktreeGcResult>;
    validatePath(path: string): string;
}
export declare function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManager;
