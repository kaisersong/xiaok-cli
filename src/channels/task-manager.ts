import type { ChannelRequest } from './webhook.js';
import type { ApprovalAction, ApprovalRequest, ChannelReplyTarget } from './types.js';
import type { ChannelAgentExecutionResult } from './agent-service.js';
import { InMemoryTaskStore, type RemoteTask } from './task-store.js';
import type { SessionBinding } from './session-binding-store.js';
import { SerialTaskManager } from '../runtime/tasking/manager.js';

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

export interface TaskStartOptions {
  binding?: SessionBinding | null;
  ackText?: string;
}

export class TaskManager extends SerialTaskManager<ChannelRequest, RemoteTask, {
  sessionId: string;
  prompt: string;
  replyTarget: ChannelReplyTarget;
  cwd?: string;
  repoRoot?: string;
  branch?: string;
}> {
  constructor(options: TaskManagerOptions) {
    super({
      store: options.store ?? new InMemoryTaskStore(),
      createTaskInput: (request, sessionId, createOptions) => {
        const taskOptions = createOptions as TaskStartOptions | undefined;
        return {
          sessionId,
          prompt: request.message,
          replyTarget: request.replyTarget,
          cwd: taskOptions?.binding?.cwd,
          repoRoot: taskOptions?.binding?.repoRoot,
          branch: taskOptions?.binding?.branch,
        };
      },
      buildAckMessage: (task, createOptions) => {
        const taskOptions = createOptions as TaskStartOptions | undefined;
        return taskOptions?.ackText ?? this.buildAckText(task);
      },
      buildCompletionSummary: (task) => this.buildCompletionText(task),
      execute: options.execute,
      notify: options.notify,
    });
  }

  getActiveTask(sessionId: string): RemoteTask | undefined {
    return super.getActiveTask(sessionId);
  }

  getActiveReplyTarget(sessionId: string): ChannelReplyTarget | undefined {
    return this.getActiveTask(sessionId)?.replyTarget;
  }

  setTaskEvent(taskId: string, latestEvent: string): RemoteTask | undefined {
    return this.store.update(taskId, { latestEvent });
  }

  setSessionProgress(sessionId: string, latestEvent: string): RemoteTask | undefined {
    const task = this.getActiveTask(sessionId);
    if (!task) {
      return undefined;
    }
    return this.store.update(task.taskId, { latestEvent });
  }

  markWaitingApproval(sessionId: string, approval: ApprovalRequest): RemoteTask | undefined {
    const task = this.getActiveTask(sessionId);
    if (!task) {
      return undefined;
    }

    return this.updateTask(task.taskId, {
      status: 'waiting_approval',
      approvalId: approval.approvalId,
      latestEvent: approval.summary,
    });
  }

  resumeFromApproval(approval: ApprovalRequest, action: ApprovalAction | 'expired'): RemoteTask | undefined {
    if (!approval.taskId) {
      return undefined;
    }

    const nextEvent =
      action === 'expired'
        ? `审批 ${approval.approvalId} 已超时失效`
        : `审批 ${approval.approvalId} 已${action === 'approve' ? '通过' : '拒绝'}`;

    return this.updateTask(approval.taskId, {
      status: 'running',
      approvalId: undefined,
      latestEvent: nextEvent,
    });
  }

  formatStatus(task: RemoteTask): string {
    const lines = [
      `任务 ${task.taskId}`,
      `状态：${task.status}`,
      `创建时间：${new Date(task.createdAt).toLocaleString()}`,
    ];
    if (task.cwd) lines.push(`工作区：${task.cwd}`);
    if (task.branch) lines.push(`分支：${task.branch}`);
    if (task.startedAt) lines.push(`开始时间：${new Date(task.startedAt).toLocaleString()}`);
    if (task.finishedAt) lines.push(`结束时间：${new Date(task.finishedAt).toLocaleString()}`);
    if (task.latestEvent) lines.push(`最近进展：${task.latestEvent}`);
    if (task.approvalId) lines.push(`待审批：${task.approvalId}`);
    if (task.replyLength) lines.push(`回复长度：${task.replyLength}`);
    if (task.replySummary) lines.push(`回复摘要：${task.replySummary}`);
    if (task.errorMessage) lines.push(`错误：${task.errorMessage}`);
    return lines.join('\n');
  }

  private buildAckText(task: RemoteTask): string {
    const lines = [
      `已创建任务 ${task.taskId}`,
      `状态：${task.status}`,
    ];
    if (task.cwd) {
      lines.push(`工作区：${task.cwd}`);
    } else {
      lines.push('当前未绑定工作区，涉及仓库文件时可先发送 /bind <cwd>');
    }
    lines.push(`发送 /status ${task.taskId} 查看进度`);
    return lines.join('\n');
  }

  private buildCompletionText(task: RemoteTask): string {
    const lines = [
      `任务 ${task.taskId} 已${task.status === 'completed' ? '完成' : task.status === 'cancelled' ? '取消' : '结束'}`,
      `状态：${task.status}`,
    ];
    if (task.replySummary) {
      lines.push(`摘要：${task.replySummary}`);
    }
    if (task.errorMessage) {
      lines.push(`错误：${task.errorMessage}`);
    }
    lines.push(`发送 /status ${task.taskId} 查看详情`);
    return lines.join('\n');
  }
}
