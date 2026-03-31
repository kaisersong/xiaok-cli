import type { ChannelReplyTarget } from './types.js';
import type { BaseTaskRecord, TaskStatus } from '../runtime/tasking/types.js';
import { InMemoryTaskStore as SharedInMemoryTaskStore } from '../runtime/tasking/store.js';
export type RemoteTaskStatus = TaskStatus;
export interface RemoteTask extends BaseTaskRecord {
    taskId: string;
    sessionId: string;
    channel: 'yzj';
    prompt: string;
    replyTarget: ChannelReplyTarget;
}
export interface CreateRemoteTaskInput {
    sessionId: string;
    prompt: string;
    replyTarget: ChannelReplyTarget;
    cwd?: string;
    repoRoot?: string;
    branch?: string;
}
export interface RemoteTaskStore {
    create(input: CreateRemoteTaskInput): RemoteTask;
    get(taskId: string): RemoteTask | undefined;
    update(taskId: string, patch: Partial<RemoteTask>): RemoteTask | undefined;
    listBySession(sessionId: string): RemoteTask[];
}
export declare class InMemoryTaskStore extends SharedInMemoryTaskStore<RemoteTask, CreateRemoteTaskInput> implements RemoteTaskStore {
    constructor();
}
export declare class FileTaskStore implements RemoteTaskStore {
    private readonly filePath;
    private readonly tasks;
    private nextId;
    constructor(filePath: string);
    create(input: CreateRemoteTaskInput): RemoteTask;
    get(taskId: string): RemoteTask | undefined;
    update(taskId: string, patch: Partial<RemoteTask>): RemoteTask | undefined;
    listBySession(sessionId: string): RemoteTask[];
    private load;
    private persist;
}
