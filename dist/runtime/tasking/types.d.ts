export type TaskStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
export interface TaskExecutionResult {
    ok: boolean;
    cancelled?: boolean;
    generationMs: number;
    deliveryMs: number;
    replyLength: number;
    replyPreview?: string;
    errorMessage?: string;
}
export interface BaseTaskRecord {
    taskId: string;
    sessionId: string;
    status: TaskStatus;
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
    finishedAt?: number;
    replySummary?: string;
    replyLength?: number;
    errorMessage?: string;
    latestEvent?: string;
    approvalId?: string;
    cwd?: string;
    repoRoot?: string;
    branch?: string;
}
