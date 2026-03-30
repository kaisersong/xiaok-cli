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
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  replySummary?: string;
  replyLength?: number;
  errorMessage?: string;
}

export class InMemoryTaskStore {
  private readonly tasks = new Map<string, RemoteTask>();
  private nextId = 1;

  create(sessionId: string, prompt: string): RemoteTask {
    const now = Date.now();
    const task: RemoteTask = {
      taskId: `task_${this.nextId++}`,
      sessionId,
      channel: 'yzj',
      status: 'queued',
      prompt,
      createdAt: now,
      updatedAt: now,
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
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}
