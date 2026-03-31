import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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

export class InMemoryTaskStore extends SharedInMemoryTaskStore<RemoteTask, CreateRemoteTaskInput> implements RemoteTaskStore {
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

interface PersistedTaskDocument {
  schemaVersion: 1;
  tasks: RemoteTask[];
}

export class FileTaskStore implements RemoteTaskStore {
  private readonly tasks = new Map<string, RemoteTask>();
  private nextId = 1;

  constructor(private readonly filePath: string) {
    this.load();
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
    this.persist();
    return task;
  }

  get(taskId: string): RemoteTask | undefined {
    return this.tasks.get(taskId);
  }

  update(taskId: string, patch: Partial<RemoteTask>): RemoteTask | undefined {
    const current = this.tasks.get(taskId);
    if (!current) {
      return undefined;
    }

    const next: RemoteTask = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, next);
    this.persist();
    return next;
  }

  listBySession(sessionId: string): RemoteTask[] {
    return [...this.tasks.values()]
      .filter((task) => task.sessionId === sessionId)
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return b.createdAt - a.createdAt;
        }
        return extractSequence(b.taskId) - extractSequence(a.taskId);
      });
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as PersistedTaskDocument;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tasks)) {
        return;
      }
      for (const task of parsed.tasks) {
        if (task?.taskId) {
          const recovered = recoverTaskAfterRestart(task);
          this.tasks.set(task.taskId, recovered);
          const seq = extractSequence(task.taskId);
          if (seq >= this.nextId) {
            this.nextId = seq + 1;
          }
        }
      }
      this.persist();
    } catch {
      return;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const doc: PersistedTaskDocument = {
      schemaVersion: 1,
      tasks: [...this.tasks.values()],
    };
    writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
  }
}

function extractSequence(taskId: string): number {
  const match = /(\d+)$/.exec(taskId);
  return match ? Number(match[1]) : 0;
}

function recoverTaskAfterRestart(task: RemoteTask): RemoteTask {
  if (task.status !== 'queued' && task.status !== 'running' && task.status !== 'waiting_approval') {
    return task;
  }

  const reason = task.status === 'waiting_approval'
    ? 'approval interrupted by process restart'
    : 'task interrupted by process restart';

  return {
    ...task,
    status: 'failed',
    finishedAt: task.finishedAt ?? Date.now(),
    errorMessage: task.errorMessage ?? reason,
    latestEvent: reason,
    approvalId: undefined,
    updatedAt: Date.now(),
  };
}
