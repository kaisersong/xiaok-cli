export type BackgroundJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export interface BackgroundJobMetadata {
    agent?: string;
    team?: string;
}
export interface BackgroundJobRecord {
    jobId: string;
    ownerId?: string;
    ownerPid?: number;
    sessionId: string;
    source: string;
    taskId?: string;
    metadata?: BackgroundJobMetadata;
    inputSummary: string;
    status: BackgroundJobStatus;
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
    finishedAt?: number;
    resultSummary?: string;
    errorMessage?: string;
}
export interface StartBackgroundJobInput {
    sessionId: string;
    source: string;
    taskId?: string;
    metadata?: BackgroundJobMetadata;
    input: unknown;
}
export interface BackgroundExecutionResult {
    ok: boolean;
    summary?: string;
    errorMessage?: string;
}
export interface BackgroundExecutionContext {
    job: BackgroundJobRecord;
    input: unknown;
    signal: AbortSignal;
}
export interface BackgroundRunnerOptions {
    rootDir: string;
    recoverInterruptedJobs?: boolean;
    shutdownTimeoutMs?: number;
    execute(context: BackgroundExecutionContext): Promise<BackgroundExecutionResult>;
    notify(job: BackgroundJobRecord): Promise<void> | void;
}
export interface BackgroundRunner {
    start(input: StartBackgroundJobInput): Promise<BackgroundJobRecord>;
    get(jobId: string): BackgroundJobRecord | undefined;
    listBySession(sessionId: string): BackgroundJobRecord[];
    listByTask(taskId: string): BackgroundJobRecord[];
    dispose(): Promise<{
        settled: boolean;
        pendingJobs: string[];
    }>;
}
export declare function createBackgroundRunner(options: BackgroundRunnerOptions): BackgroundRunner;
