import type { ChannelReplyTarget } from './types.js';

export type RemoteTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

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

export class InMemoryTaskStore {
  private readonly tasks = new Map<string, RemoteTask>();
  private nextId = 1;

  private compareTasks(a: RemoteTask, b: RemoteTask): number {
    if (a.createdAt !== b.createdAt) {
      return b.createdAt - a.createdAt;
    }

    return this.extractTaskSequence(b.taskId) - this.extractTaskSequence(a.taskId);
  }

  private extractTaskSequence(taskId: string): number {
    const match = /(\d+)$/.exec(taskId);
    return match ? Number(match[1]) : 0;
  }

  create(input: CreateRemoteTaskInput): RemoteTask {
    const now = Date.now();
    const task: RemoteTask = {
      taskId: `task_${this.nextId++}`,
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
    };
    this.tasks.set(task.taskId, task);
    return task;
  }

  get(taskId: string): RemoteTask | undefined {
    return this.tasks.get(taskId);
  }

  update(taskId: string, patch: Partial<RemoteTask>): RemoteTask | undefined {
    const current = this.tasks.get(taskId);
    if (!current) return undefined;
    const next: RemoteTask = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, next);
    return next;
  }

  listBySession(sessionId: string): RemoteTask[] {
    return [...this.tasks.values()]
      .filter((task) => task.sessionId === sessionId)
      .sort((a, b) => this.compareTasks(a, b));
  }
}
