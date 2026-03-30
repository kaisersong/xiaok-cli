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

export class InMemoryTaskStore extends SharedInMemoryTaskStore<RemoteTask, CreateRemoteTaskInput> {
  constructor() {
    super((taskId, now, input) => ({
      taskId,
      sessionId: input.sessionId,
      channel: 'yzj',
      status: 'queued',
      prompt: input.prompt,
      replyTarget: input.replyTarget,
      createdAt: now,
      updatedAt: now,
      cwd: input.cwd,
      repoRoot: input.repoRoot,
      branch: input.branch,
    }));
  }
}
