import type { BaseTaskRecord, TaskExecutionResult } from './types.js';
import { InMemoryTaskStore } from './store.js';
export interface TaskExecutionRequest<TRequest> {
    request: TRequest;
    sessionId: string;
    taskId: string;
    signal: AbortSignal;
}
export interface SerialTaskManagerOptions<TRequest, TTask extends BaseTaskRecord, TCreateInput> {
    store: InMemoryTaskStore<TTask, TCreateInput>;
    createTaskInput(request: TRequest, sessionId: string, options?: unknown): TCreateInput;
    buildAckMessage(task: TTask, options?: unknown): string;
    buildCompletionSummary(task: TTask): string;
    execute(request: TaskExecutionRequest<TRequest>): Promise<TaskExecutionResult>;
    notify(request: TRequest, text: string): Promise<void> | void;
}
export declare class SerialTaskManager<TRequest, TTask extends BaseTaskRecord, TCreateInput> {
    protected readonly store: InMemoryTaskStore<TTask, TCreateInput>;
    private readonly running;
    private readonly sessionTails;
    private readonly activeBySession;
    private readonly createTaskInput;
    private readonly buildAckMessageImpl;
    private readonly buildCompletionSummaryImpl;
    private readonly executeTask;
    private readonly notify;
    constructor(options: SerialTaskManagerOptions<TRequest, TTask, TCreateInput>);
    createAndStart(request: TRequest, sessionId: string, options?: unknown): Promise<TTask>;
    getTask(taskId: string): TTask | undefined;
    getLatestTask(sessionId: string): TTask | undefined;
    listTasks(sessionId: string): TTask[];
    getActiveTask(sessionId: string): TTask | undefined;
    protected updateTask(taskId: string, patch: Partial<TTask>): TTask | undefined;
    setTaskEvent(taskId: string, latestEvent: string): TTask | undefined;
    setSessionProgress(sessionId: string, latestEvent: string): TTask | undefined;
    cancelTask(taskId: string): {
        ok: boolean;
        message: string;
        task?: TTask;
    };
    protected buildCompletionSummary(task: TTask): string;
    private runTask;
}
