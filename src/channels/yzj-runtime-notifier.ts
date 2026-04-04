import type { RuntimeHooks, RuntimeHookUnsubscribe } from '../runtime/hooks.js';
import type { ApprovalStore } from './approval-store.js';
import type { ChannelReplyTarget } from './types.js';
import type { TaskManager } from './task-manager.js';
import { describeToolActivity } from '../ui/render.js';

export interface YZJRuntimeNotificationTransport {
  send(target: ChannelReplyTarget, text: string): Promise<void> | void;
}

interface SessionBuffer {
  lines: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

export class YZJRuntimeNotifier {
  private readonly buffers = new Map<string, SessionBuffer>();

  constructor(
    private readonly transport: YZJRuntimeNotificationTransport,
    private readonly taskManager: TaskManager,
    private readonly approvalStore: ApprovalStore,
    private readonly flushDelayMs = 1500
  ) {}

  bind(sessionId: string, hooks: RuntimeHooks): RuntimeHookUnsubscribe {
    const subscriptions = [
      hooks.on('turn_started', () => {
        const task = this.taskManager.getActiveTask(sessionId);
        if (!task) {
          return;
        }
        this.taskManager.setTaskEvent(task.taskId, 'Agent 已开始执行');
        void this.sendForSession(sessionId, `任务 ${task.taskId} 开始执行`);
      }),
      hooks.on('tool_started', (event) => {
        const task = this.taskManager.getActiveTask(sessionId);
        if (!task) {
          return;
        }
        this.taskManager.setTaskEvent(task.taskId, `执行工具 ${event.toolName}`);
        const activity = describeToolActivity(event.toolName, event.toolInput);
        if (activity) {
          this.enqueueProgress(sessionId, activity);
        }
      }),
      hooks.on('tool_finished', (event) => {
        const task = this.taskManager.getActiveTask(sessionId);
        if (!task) {
          return;
        }
        this.taskManager.setTaskEvent(task.taskId, `工具 ${event.toolName} ${event.ok ? '完成' : '失败'}`);
        this.enqueueProgress(sessionId, `${event.toolName} ${event.ok ? '完成' : '失败'}`);
      }),
      hooks.on('compact_triggered', () => {
        const task = this.taskManager.getActiveTask(sessionId);
        if (!task) {
          return;
        }
        this.taskManager.setTaskEvent(task.taskId, '上下文已压缩');
        void this.sendForSession(sessionId, `任务 ${task.taskId}：上下文已压缩，已保留最近上下文`);
      }),
      hooks.on('approval_required', (event) => {
        const task = this.taskManager.getActiveTask(sessionId);
        const approval = this.approvalStore.get(event.approvalId);
        if (!task || !approval) {
          return;
        }
        this.taskManager.markWaitingApproval(sessionId, approval);
        void this.flushSession(sessionId);
        void this.sendForSession(
          sessionId,
          [
            `任务 ${task.taskId} 需要审批`,
            `审批单：${approval.approvalId}`,
            `操作：${approval.toolName ?? 'unknown'}`,
            `摘要：${approval.summary}`,
            `发送 /approve ${approval.approvalId} 或 /deny ${approval.approvalId}`,
          ].join('\n')
        );
      }),
    ];

    return () => {
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
      const buffer = this.buffers.get(sessionId);
      if (buffer?.timer) {
        clearTimeout(buffer.timer);
      }
      this.buffers.delete(sessionId);
    };
  }

  private enqueueProgress(sessionId: string, line: string): void {
    const buffer = this.buffers.get(sessionId) ?? { lines: [], timer: null };
    buffer.lines.push(line);
    if (!buffer.timer) {
      buffer.timer = setTimeout(() => {
        void this.flushSession(sessionId);
      }, this.flushDelayMs);
    }
    this.buffers.set(sessionId, buffer);
  }

  private async flushSession(sessionId: string): Promise<void> {
    const buffer = this.buffers.get(sessionId);
    if (!buffer || buffer.lines.length === 0) {
      if (buffer?.timer) {
        clearTimeout(buffer.timer);
        buffer.timer = null;
      }
      return;
    }

    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    const task = this.taskManager.getActiveTask(sessionId);
    const target = this.taskManager.getActiveReplyTarget(sessionId);
    const lines = buffer.lines.splice(0, buffer.lines.length);
    if (!task || !target) {
      return;
    }

    await Promise.resolve(this.transport.send(target, [`任务 ${task.taskId} 进展：`, ...lines].join('\n'))).catch((error: unknown) => {
      console.error(`[yzj] notification delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async sendForSession(sessionId: string, text: string): Promise<void> {
    const target = this.taskManager.getActiveReplyTarget(sessionId);
    if (!target) {
      return;
    }
    await Promise.resolve(this.transport.send(target, text)).catch((error: unknown) => {
      console.error(`[yzj] session message delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
