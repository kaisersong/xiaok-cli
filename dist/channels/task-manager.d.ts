import type { ChannelRequest } from './webhook.js';
import type { ApprovalAction, ApprovalRequest, ChannelReplyTarget } from './types.js';
import type { ChannelAgentExecutionResult } from './agent-service.js';
import { type RemoteTask, type RemoteTaskStore } from './task-store.js';
import type { SessionBinding } from './session-binding-store.js';
import { SerialTaskManager } from '../runtime/tasking/manager.js';
export interface TaskExecutionRequest {
    request: ChannelRequest;
    sessionId: string;
    taskId: string;
    signal: AbortSignal;
}
export interface TaskManagerOptions {
    store?: RemoteTaskStore;
    execute(request: TaskExecutionRequest): Promise<ChannelAgentExecutionResult>;
    notify(request: ChannelRequest, text: string): Promise<void> | void;
}
export interface TaskStartOptions {
    binding?: SessionBinding | null;
    ackText?: string;
}
export declare class TaskManager extends SerialTaskManager<ChannelRequest, RemoteTask, {
    sessionId: string;
    prompt: string;
    replyTarget: ChannelReplyTarget;
    cwd?: string;
    repoRoot?: string;
    branch?: string;
}> {
    constructor(options: TaskManagerOptions);
    getActiveTask(sessionId: string): RemoteTask | undefined;
    getPreferredStatusTask(sessionId: string): RemoteTask | undefined;
    getActiveReplyTarget(sessionId: string): ChannelReplyTarget | undefined;
    setTaskEvent(taskId: string, latestEvent: string): RemoteTask | undefined;
    setSessionProgress(sessionId: string, latestEvent: string): RemoteTask | undefined;
    markWaitingApproval(sessionId: string, approval: ApprovalRequest): RemoteTask | undefined;
    resumeFromApproval(approval: ApprovalRequest, action: ApprovalAction | 'expired'): RemoteTask | undefined;
    markApprovalInterrupted(approval: ApprovalRequest, reason?: string): RemoteTask | undefined;
    formatStatus(task: RemoteTask): string;
    private buildAckText;
    private buildCompletionText;
}
