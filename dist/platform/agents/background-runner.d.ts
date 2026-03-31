export type BackgroundJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export interface BackgroundJobRecord {
    jobId: string;
    sessionId: string;
    source: string;
    taskId?: string;
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
}
export interface BackgroundRunnerOptions {
    rootDir: string;
    execute(context: BackgroundExecutionContext): Promise<BackgroundExecutionResult>;
    notify(job: BackgroundJobRecord): Promise<void> | void;
}
export interface BackgroundRunner {
    start(input: StartBackgroundJobInput): Promise<BackgroundJobRecord>;
    get(jobId: string): BackgroundJobRecord | undefined;
    listBySession(sessionId: string): BackgroundJobRecord[];
    listByTask(taskId: string): BackgroundJobRecord[];
}
export declare function createBackgroundRunner(options: BackgroundRunnerOptions): BackgroundRunner;
