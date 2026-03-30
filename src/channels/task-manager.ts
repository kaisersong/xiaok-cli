import type { ChannelRequest } from './webhook.js';
import type { ChannelAgentExecutionResult } from './agent-service.js';
import { InMemoryTaskStore, type RemoteTask } from './task-store.js';

export interface TaskExecutionRequest {
  request: ChannelRequest;
  sessionId: string;
  taskId: string;
  signal: AbortSignal;
}

export interface TaskManagerOptions {
  store?: InMemoryTaskStore;
  execute(request: TaskExecutionRequest): Promise<ChannelAgentExecutionResult>;
  notify(request: ChannelRequest, text: string): Promise<void> | void;
}

type RunningTask = {
  sessionId: string;
  abortController: AbortController;
};

export class TaskManager {
  private readonly store: InMemoryTaskStore;
  private readonly running = new Map<string, RunningTask>();
  private readonly executeTask: TaskManagerOptions['execute'];
  private readonly notify: TaskManagerOptions['notify'];

  constructor(options: TaskManagerOptions) {
    this.store = options.store ?? new InMemoryTaskStore();
    this.executeTask = options.execute;
    this.notify = options.notify;
  }

  async createAndStart(request: ChannelRequest, sessionId: string): Promise<RemoteTask> {
    const task = this.store.create(sessionId, request.message);
    await this.notify(
      request,
      `已创建任务 ${task.taskId}\n状态：queued\n发送 /status ${task.taskId} 查看进度`
    );

    const abortController = new AbortController();
    this.running.set(task.taskId, { sessionId, abortController });
    queueMicrotask(() => {
      void this.runTask(task.taskId, request, sessionId, abortController);
    });
    return this.store.get(task.taskId)!;
  }

  getTask(taskId: string): RemoteTask | undefined {
    return this.store.get(taskId);
  }

  getLatestTask(sessionId: string): RemoteTask | undefined {
    return this.store.listBySession(sessionId)[0];
  }

  listTasks(sessionId: string): RemoteTask[] {
    return this.store.listBySession(sessionId);
  }

  cancelTask(taskId: string): { ok: boolean; message: string; task?: RemoteTask } {
    const task = this.store.get(taskId);
    if (!task) {
      return { ok: false, message: `未找到任务 ${taskId}` };
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return { ok: false, message: `任务 ${taskId} 当前状态为 ${task.status}，不可取消`, task };
    }

    const running = this.running.get(taskId);
    if (!running) {
      this.store.update(taskId, {
        status: 'cancelled',
        finishedAt: Date.now(),
        errorMessage: 'cancelled before execution binding',
      });
      return { ok: true, message: `任务 ${taskId} 已取消`, task: this.store.get(taskId)! };
    }

    running.abortController.abort();
    this.store.update(taskId, {
      status: 'cancelled',
      finishedAt: Date.now(),
      errorMessage: 'cancelled by user',
    });
    this.running.delete(taskId);
    return { ok: true, message: `任务 ${taskId} 已取消`, task: this.store.get(taskId)! };
  }

  formatStatus(task: RemoteTask): string {
    const lines = [
      `任务 ${task.taskId}`,
      `状态：${task.status}`,
      `创建时间：${new Date(task.createdAt).toLocaleString()}`,
    ];
    if (task.startedAt) lines.push(`开始时间：${new Date(task.startedAt).toLocaleString()}`);
    if (task.finishedAt) lines.push(`结束时间：${new Date(task.finishedAt).toLocaleString()}`);
    if (task.replyLength) lines.push(`回复长度：${task.replyLength}`);
    if (task.replySummary) lines.push(`回复摘要：${task.replySummary}`);
    if (task.errorMessage) lines.push(`错误：${task.errorMessage}`);
    return lines.join('\n');
  }

  private async runTask(
    taskId: string,
    request: ChannelRequest,
    sessionId: string,
    abortController: AbortController
  ): Promise<void> {
    try {
      if (abortController.signal.aborted) {
        return;
      }

      this.store.update(taskId, {
        status: 'running',
        startedAt: Date.now(),
      });

      const result = await this.executeTask({
        request,
        sessionId,
        taskId,
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) {
        this.store.update(taskId, {
          status: 'cancelled',
          finishedAt: Date.now(),
          errorMessage: 'cancelled by user',
        });
        return;
      }

      if (result.ok) {
        this.store.update(taskId, {
          status: 'completed',
          finishedAt: Date.now(),
          replyLength: result.replyLength,
          replySummary: result.replyPreview,
        });
        return;
      }

      this.store.update(taskId, {
        status: result.cancelled ? 'cancelled' : 'failed',
        finishedAt: Date.now(),
        errorMessage: result.errorMessage,
      });
    } finally {
      this.running.delete(taskId);
    }
  }
}
