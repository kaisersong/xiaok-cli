import type { ChannelReplyTarget } from './types.js';
export type RemoteTaskStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
export interface RemoteTask {
    taskId: string;
    sessionId: string;
    channel: 'yzj';
    status: RemoteTaskStatus;
    prompt: string;
    replyTarget: ChannelReplyTarget;
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
export interface CreateRemoteTaskInput {
    sessionId: string;
    prompt: string;
    replyTarget: ChannelReplyTarget;
    cwd?: string;
    repoRoot?: string;
    branch?: string;
}
export declare class InMemoryTaskStore {
    private readonly tasks;
    private nextId;
    create(input: CreateRemoteTaskInput): RemoteTask;
    get(taskId: string): RemoteTask | undefined;
    update(taskId: string, patch: Partial<RemoteTask>): RemoteTask | undefined;
    listBySession(sessionId: string): RemoteTask[];
}
