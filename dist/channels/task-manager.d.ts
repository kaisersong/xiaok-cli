import type { ChannelRequest } from './webhook.js';
import type { ApprovalAction, ApprovalRequest, ChannelReplyTarget } from './types.js';
import type { ChannelAgentExecutionResult } from './agent-service.js';
import { InMemoryTaskStore, type RemoteTask } from './task-store.js';
import type { SessionBinding } from './session-binding-store.js';
export interface TaskExecutionRequest {
    request: ChannelRequest;
    sessionId: string;
    taskId: string;
    signal: AbortSignal;
}
export interface TaskManagerOptions {
    store?: InMemoryTaskStore;
    execute(request: TaskExecutionRequest): Promise<ChannelAgentExecutionResult>;
    notify(request: ChannelRequest, text: string): Promise<void> | void;
}
export interface TaskStartOptions {
    binding?: SessionBinding | null;
    ackText?: string;
}
export declare class TaskManager {
    private readonly store;
    private readonly running;
    private readonly sessionTails;
    private readonly activeBySession;
    private readonly executeTask;
    private readonly notify;
    constructor(options: TaskManagerOptions);
    createAndStart(request: ChannelRequest, sessionId: string, options?: TaskStartOptions): Promise<RemoteTask>;
    getTask(taskId: string): RemoteTask | undefined;
    getLatestTask(sessionId: string): RemoteTask | undefined;
    listTasks(sessionId: string): RemoteTask[];
    getActiveTask(sessionId: string): RemoteTask | undefined;
    getActiveReplyTarget(sessionId: string): ChannelReplyTarget | undefined;
    setTaskEvent(taskId: string, latestEvent: string): RemoteTask | undefined;
    setSessionProgress(sessionId: string, latestEvent: string): RemoteTask | undefined;
    markWaitingApproval(sessionId: string, approval: ApprovalRequest): RemoteTask | undefined;
    resumeFromApproval(approval: ApprovalRequest, action: ApprovalAction | 'expired'): RemoteTask | undefined;
    cancelTask(taskId: string): {
        ok: boolean;
        message: string;
        task?: RemoteTask;
    };
    formatStatus(task: RemoteTask): string;
    private runTask;
    private buildAckMessage;
    private buildCompletionSummary;
}
