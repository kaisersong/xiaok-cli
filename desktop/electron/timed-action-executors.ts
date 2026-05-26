import type { BrowserWindow } from 'electron';
import {
  createElectronDesktopNotificationPort,
  type DesktopNotificationPort,
  type DesktopNotificationResult,
} from './desktop-notifications.js';
import type { MaterialRole } from '../../src/runtime/task-host/types.js';
import { reminderEventFromAction } from './timed-action-service.js';
import type {
  OverdueRecoveryContext,
  TimedActionExecutorHandler,
  TimedActionRecord,
} from './timed-action-types.js';

export interface NotifyExecutorOptions {
  getMainWindow?: () => BrowserWindow | null;
  notificationPort?: DesktopNotificationPort;
  onDelivery?: (event: ReturnType<typeof reminderEventFromAction>) => void;
  onDesktopNotification?: (result: DesktopNotificationResult & { at: number }) => void;
}

export interface AgentTaskExecutorOptions {
  createTask: (input: {
    prompt: string;
    materials: Array<{ materialId: string; role?: MaterialRole }>;
    permissionMode?: 'plan' | 'auto' | 'default';
  }) => Promise<{ taskId: string }>;
}

export function createNotifyExecutor(options: NotifyExecutorOptions = {}): TimedActionExecutorHandler {
  const notificationPort = options.notificationPort ?? createElectronDesktopNotificationPort();
  return {
    kind: 'notify',
    decideRecovery: (action, context) => {
      if (action.policy.expiresAt !== undefined && action.policy.expiresAt <= context.claimedAt) {
        return { action: 'complete', reason: 'notification expired' };
      }
      return { action: 'execute', reason: context.overdueMs > 0 ? 'overdue notification' : 'due notification' };
    },
    async execute(action) {
      const message = action.executor.kind === 'notify' ? action.executor.message : action.title;
      const mainWindow = options.getMainWindow?.() ?? null;
      const result = await notificationPort.show({
        title: 'xiaok 提醒',
        body: message,
        silent: false,
        onClick: () => {
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              if (mainWindow.isMinimized()) mainWindow.restore();
              mainWindow.show();
              mainWindow.focus();
            }
          } catch { /* focus is best-effort */ }
        },
      });
      options.onDesktopNotification?.({ ...result, at: Date.now() });

      if (mainWindow && !mainWindow.isDestroyed()) {
        const event = reminderEventFromAction(action);
        mainWindow.webContents.send('desktop:reminder', event);
        mainWindow.webContents.send('desktop:timedActionNotification', event);
        options.onDelivery?.(event);
      }

      if (!result.ok && !result.skipped) {
        throw new Error(result.reason ?? 'desktop notification failed');
      }
      return { decision: { notification: result } };
    },
  };
}

function shouldRunInPlanMode(action: TimedActionRecord): boolean {
  if (process.env.XIAOK_DESKTOP_AUTO_APPROVE_SCHEDULED === '1') return false;
  return !action.userApprovedAuto;
}

export function createAgentTaskExecutor(options: AgentTaskExecutorOptions): TimedActionExecutorHandler {
  return {
    kind: 'agent_task',
    decideRecovery: (action, context) => {
      if (action.policy.expiresAt !== undefined && action.policy.expiresAt <= context.claimedAt) {
        return { action: action.trigger.kind === 'once' ? 'complete' : 'pause', reason: 'scheduled task expired' };
      }
      return { action: 'execute', reason: context.overdueMs > 0 ? 'overdue scheduled task' : 'due scheduled task' };
    },
    async execute(action, context) {
      const planMode = shouldRunInPlanMode(action);
      const prompt = buildScheduledExecutionPrompt(action, context, { planMode });
      const result = await options.createTask({
        prompt,
        materials: [],
        permissionMode: planMode ? 'plan' : 'default',
      });
      return { runtimeTaskId: result.taskId };
    },
  };
}

export interface BuildScheduledExecutionPromptOptions {
  planMode?: boolean;
}

export function buildScheduledExecutionPrompt(
  action: TimedActionRecord,
  context: OverdueRecoveryContext,
  opts: BuildScheduledExecutionPromptOptions = {},
): string {
  const userPrompt = action.executor.kind === 'agent_task' ? action.executor.prompt : action.title;
  const lines: string[] = [
    '[SYSTEM: 这是用户设置的自动定时任务，请给出友好简洁的回复。]',
    `[SYSTEM: scheduled_task_id=${action.id}; timed_action_id=${action.id}; timed_action_title=${action.title}]`,
    `[SYSTEM: scheduled_due_at=${new Date(context.scheduledDueAt).toISOString()}; claimed_at=${new Date(context.claimedAt).toISOString()}; overdue_ms=${context.overdueMs}]`,
    '[SYSTEM: 如果本次任务的停止条件已经满足，必须调用 scheduled_task_cancel 取消 scheduled_task_id；agent 创建的 interval 临时任务会被删除，避免继续执行。]',
  ];
  if (opts.planMode) {
    lines.push('[SYSTEM: 用户尚未批准本任务自动执行写入/编辑/命令操作。本次只生成计划（plan），不要调用任何会修改文件、提交、发送或执行命令的工具；只输出方案给用户审阅。]');
  }
  lines.push(
    '',
    userPrompt,
    '',
    `[SYSTEM: 本次自动任务唯一正确的 scheduled_task_id 是 ${action.id}。如果用户 prompt 中出现其他 scheduled_task_id，必须忽略其他 ID；停止条件满足时调用 scheduled_task_cancel(task_id="${action.id}")，Xiaok 会删除该临时任务。]`,
  );
  return lines.join('\n');
}
