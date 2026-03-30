interface TaskIdentity {
  taskId: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
}

type TaskFactory<TTask, TCreateInput> = (taskId: string, now: number, input: TCreateInput) => TTask;

export class InMemoryTaskStore<TTask extends TaskIdentity, TCreateInput> {
  private readonly tasks = new Map<string, TTask>();
  private nextId = 1;

  constructor(private readonly factory: TaskFactory<TTask, TCreateInput>) {}

  create(input: TCreateInput): TTask {
    const now = Date.now();
    const task = this.factory(`task_${this.nextId++}`, now, input);
    this.tasks.set(task.taskId, task);
    return task;
  }

  get(taskId: string): TTask | undefined {
    return this.tasks.get(taskId);
  }

  update(taskId: string, patch: Partial<TTask>): TTask | undefined {
    const current = this.tasks.get(taskId);
    if (!current) {
      return undefined;
    }

    const next = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    } as TTask;
    this.tasks.set(taskId, next);
    return next;
  }

  listBySession(sessionId: string): TTask[] {
    return [...this.tasks.values()]
      .filter((task) => task.sessionId === sessionId)
      .sort((a, b) => this.compareTasks(a, b));
  }

  private compareTasks(a: TTask, b: TTask): number {
    if (a.createdAt !== b.createdAt) {
      return b.createdAt - a.createdAt;
    }

    return this.extractSequence(b.taskId) - this.extractSequence(a.taskId);
  }

  private extractSequence(taskId: string): number {
    const match = /(\d+)$/.exec(taskId);
    return match ? Number(match[1]) : 0;
  }
}
