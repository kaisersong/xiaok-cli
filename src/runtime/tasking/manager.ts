import type { BaseTaskRecord, TaskExecutionResult } from './types.js';
import { InMemoryTaskStore } from './store.js';

export interface TaskExecutionRequest<TRequest> {
  request: TRequest;
  sessionId: string;
  taskId: string;
  signal: AbortSignal;
}

interface RunningTask {
  sessionId: string;
  abortController: AbortController;
}

export interface SerialTaskManagerOptions<TRequest, TTask extends BaseTaskRecord, TCreateInput> {
  store: InMemoryTaskStore<TTask, TCreateInput>;
  createTaskInput(request: TRequest, sessionId: string, options?: unknown): TCreateInput;
  buildAckMessage(task: TTask, options?: unknown): string;
  buildCompletionSummary(task: TTask): string;
  execute(request: TaskExecutionRequest<TRequest>): Promise<TaskExecutionResult>;
  notify(request: TRequest, text: string): Promise<void> | void;
}

export class SerialTaskManager<TRequest, TTask extends BaseTaskRecord, TCreateInput> {
  protected readonly store: InMemoryTaskStore<TTask, TCreateInput>;
  private readonly running = new Map<string, RunningTask>();
  private readonly sessionTails = new Map<string, Promise<void>>();
  private readonly activeBySession = new Map<string, string>();
  private readonly createTaskInput: SerialTaskManagerOptions<TRequest, TTask, TCreateInput>['createTaskInput'];
  private readonly buildAckMessageImpl: SerialTaskManagerOptions<TRequest, TTask, TCreateInput>['buildAckMessage'];
  private readonly buildCompletionSummaryImpl: SerialTaskManagerOptions<TRequest, TTask, TCreateInput>['buildCompletionSummary'];
  private readonly executeTask: SerialTaskManagerOptions<TRequest, TTask, TCreateInput>['execute'];
  private readonly notify: SerialTaskManagerOptions<TRequest, TTask, TCreateInput>['notify'];

  constructor(options: SerialTaskManagerOptions<TRequest, TTask, TCreateInput>) {
    this.store = options.store;
    this.createTaskInput = options.createTaskInput;
    this.buildAckMessageImpl = options.buildAckMessage;
    this.buildCompletionSummaryImpl = options.buildCompletionSummary;
    this.executeTask = options.execute;
    this.notify = options.notify;
  }

  async createAndStart(request: TRequest, sessionId: string, options?: unknown): Promise<TTask> {
    const task = this.store.create(this.createTaskInput(request, sessionId, options));
    await this.notify(request, this.buildAckMessageImpl(task, options));

    const abortController = new AbortController();
    this.running.set(task.taskId, { sessionId, abortController });
    const previous = this.sessionTails.get(sessionId) ?? Promise.resolve();
    const scheduled = previous
      .catch(() => undefined)
      .then(async () => {
        await this.runTask(task.taskId, request, sessionId, abortController);
      });
    this.sessionTails.set(sessionId, scheduled.then(() => undefined, () => undefined));
    return this.store.get(task.taskId)!;
  }

  getTask(taskId: string): TTask | undefined {
    return this.store.get(taskId);
  }

  getLatestTask(sessionId: string): TTask | undefined {
    return this.store.listBySession(sessionId)[0];
  }

  listTasks(sessionId: string): TTask[] {
    return this.store.listBySession(sessionId);
  }

  getActiveTask(sessionId: string): TTask | undefined {
    const taskId = this.activeBySession.get(sessionId);
    return taskId ? this.store.get(taskId) : undefined;
  }

  protected updateTask(taskId: string, patch: Partial<TTask>): TTask | undefined {
    return this.store.update(taskId, patch);
  }

  setTaskEvent(taskId: string, latestEvent: string): TTask | undefined {
    return this.updateTask(taskId, { latestEvent } as Partial<TTask>);
  }

  setSessionProgress(sessionId: string, latestEvent: string): TTask | undefined {
    const task = this.getActiveTask(sessionId);
    if (!task) {
      return undefined;
    }
    return this.setTaskEvent(task.taskId, latestEvent);
  }

  cancelTask(taskId: string): { ok: boolean; message: string; task?: TTask } {
    const task = this.store.get(taskId);
    if (!task) {
      return { ok: false, message: `未找到任务 ${taskId}` };
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return { ok: false, message: `任务 ${taskId} 当前状态为 ${task.status}，不可取消`, task };
    }

    const running = this.running.get(taskId);
    if (!running) {
      this.updateTask(taskId, {
        status: 'cancelled',
        finishedAt: Date.now(),
        errorMessage: 'cancelled before execution binding',
      } as Partial<TTask>);
      return { ok: true, message: `任务 ${taskId} 已取消`, task: this.store.get(taskId)! };
    }

    running.abortController.abort();
    this.updateTask(taskId, {
      status: 'cancelled',
      finishedAt: Date.now(),
      errorMessage: 'cancelled by user',
    } as Partial<TTask>);
    this.running.delete(taskId);
    return { ok: true, message: `任务 ${taskId} 已取消`, task: this.store.get(taskId)! };
  }

  protected buildCompletionSummary(task: TTask): string {
    return this.buildCompletionSummaryImpl(task);
  }

  private async runTask(
    taskId: string,
    request: TRequest,
    sessionId: string,
    abortController: AbortController,
  ): Promise<void> {
    try {
      if (abortController.signal.aborted) {
        return;
      }

      this.activeBySession.set(sessionId, taskId);
      this.updateTask(taskId, {
        status: 'running',
        startedAt: Date.now(),
        latestEvent: '任务开始执行',
      } as Partial<TTask>);

      const result = await this.executeTask({
        request,
        sessionId,
        taskId,
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) {
        this.updateTask(taskId, {
          status: 'cancelled',
          finishedAt: Date.now(),
          errorMessage: 'cancelled by user',
        } as Partial<TTask>);
        return;
      }

      if (result.ok) {
        const completed = this.updateTask(taskId, {
          status: 'completed',
          finishedAt: Date.now(),
          replyLength: result.replyLength,
          replySummary: result.replyPreview,
          latestEvent: result.replyLength > 0 ? '任务完成并已发送结果' : '任务完成',
        } as Partial<TTask>);
        if (completed && (completed.replyLength ?? 0) > 1200) {
          await this.notify(request, this.buildCompletionSummary(completed));
        }
        return;
      }

      const failed = this.updateTask(taskId, {
        status: result.cancelled ? 'cancelled' : 'failed',
        finishedAt: Date.now(),
        errorMessage: result.errorMessage,
        latestEvent: result.cancelled ? '任务已取消' : '任务执行失败',
      } as Partial<TTask>);
      if (failed) {
        await this.notify(request, this.buildCompletionSummary(failed));
      }
    } finally {
      this.running.delete(taskId);
      if (this.activeBySession.get(sessionId) === taskId) {
        this.activeBySession.delete(sessionId);
      }
    }
  }
}
