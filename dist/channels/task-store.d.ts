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
export declare class InMemoryTaskStore extends SharedInMemoryTaskStore<RemoteTask, CreateRemoteTaskInput> {
    constructor();
}
