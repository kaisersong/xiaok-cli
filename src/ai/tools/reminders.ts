import type { Tool } from '../../types.js';
import { formatReminderTime, type ReminderApi } from '../../runtime/reminder/service.js';

export interface ReminderToolOptions {
  reminders: ReminderApi;
  sessionId: string;
  creatorUserId: string;
  timezone: string;
}

export function createReminderTools(options: ReminderToolOptions): Tool[] {
  const { reminders, sessionId, creatorUserId, timezone } = options;

  return [
    {
      permission: 'safe',
      definition: {
        name: 'reminder_create',
        description: '为当前会话创建一个一次性提醒',
        inputSchema: {
          type: 'object',
          properties: {
            request: { type: 'string', description: '自然语言提醒请求，例如"30分钟后提醒我发日报"' },
            content: { type: 'string', description: '提醒内容（结构化创建时使用）' },
            schedule_at: { type: 'string', description: '提醒时间，建议使用 ISO 8601' },
            timezone: { type: 'string', description: '时区，默认沿用当前会话时区' },
          },
          required: [],
        },
      },
      async execute(input) {
        const request = typeof input.request === 'string' ? input.request.trim() : '';
        const content = typeof input.content === 'string' ? input.content.trim() : '';
        const scheduleAt = typeof input.schedule_at === 'string' ? input.schedule_at.trim() : '';
        const selectedTimezone = typeof input.timezone === 'string' ? input.timezone.trim() : timezone;

        const created = await (request
          ? reminders.createFromRequest({
            sessionId,
            creatorUserId,
            request,
            timezone: selectedTimezone,
          })
          : reminders.createStructured({
            sessionId,
            creatorUserId,
            content,
            scheduleAt,
            timezone: selectedTimezone,
          }));

        if (!created.ok) {
          return `Error: ${created.message}`;
        }

        return JSON.stringify(presentReminder(created.reminder), null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'reminder_list',
        description: '列出当前会话中由当前用户创建的提醒',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      async execute() {
        const remindersForSession = await reminders.listForCreator(sessionId, creatorUserId);
        return JSON.stringify(remindersForSession.map((reminder) => presentReminder(reminder)), null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'reminder_cancel',
        description: '取消当前会话中的一个未触发提醒',
        inputSchema: {
          type: 'object',
          properties: {
            reminder_id: { type: 'string', description: '提醒 ID' },
          },
          required: ['reminder_id'],
        },
      },
      async execute(input) {
        const reminderId = typeof input.reminder_id === 'string' ? input.reminder_id.trim() : '';
        if (!reminderId) {
          return 'Error: reminder_id 不能为空';
        }

        const cancelled = await reminders.cancelForCreator(reminderId, creatorUserId);
        if (!cancelled) {
          return `Error: 未找到可取消的提醒 ${reminderId}`;
        }

        return JSON.stringify(presentReminder(cancelled), null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'task_create',
        description: '创建一个定时任务，到时间后自动执行。用于"每N分钟检查"、"定时执行XX"等场景。',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '任务描述' },
            schedule_at: { type: 'string', description: '首次执行时间，ISO 8601 格式' },
            interval_ms: { type: 'number', description: '循环间隔（毫秒）。不提供则只执行一次。' },
            max_occurrences: { type: 'number', description: '最大执行次数（可选）' },
            execution_prompt: { type: 'string', description: '到时间后 AI 应执行的指令（可选）' },
            timezone: { type: 'string', description: '时区，默认沿用当前会话时区' },
          },
          required: ['content', 'schedule_at'],
        },
      },
      async execute(input) {
        const content = typeof input.content === 'string' ? input.content.trim() : '';
        const scheduleAt = typeof input.schedule_at === 'string' ? input.schedule_at.trim() : '';
        const selectedTimezone = typeof input.timezone === 'string' ? input.timezone.trim() : timezone;

        if (!content) return 'Error: content 不能为空';

        const recurrence = typeof input.interval_ms === 'number' && input.interval_ms > 0
          ? {
              type: 'interval' as const,
              intervalMs: input.interval_ms,
              maxOccurrences: typeof input.max_occurrences === 'number' ? input.max_occurrences : undefined,
              occurrenceCount: 0,
            }
          : undefined;

        const execution = typeof input.execution_prompt === 'string' && input.execution_prompt.trim()
          ? { prompt: input.execution_prompt.trim() }
          : undefined;

        const created = await reminders.createStructured({
          sessionId,
          creatorUserId,
          content,
          scheduleAt,
          timezone: selectedTimezone,
          taskType: 'scheduled_task',
          recurrence,
          execution,
        });

        if (!created.ok) {
          return `Error: ${created.message}`;
        }

        return JSON.stringify(presentReminder(created.reminder), null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'task_list',
        description: '列出当前会话的所有定时任务',
        inputSchema: { type: 'object', properties: {} },
      },
      async execute() {
        const tasks = await reminders.listTasksForCreator(sessionId, creatorUserId);
        return JSON.stringify(tasks.map(presentReminder), null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'task_cancel',
        description: '取消一个定时任务及其所有后续执行',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: '任务 ID' },
          },
          required: ['task_id'],
        },
      },
      async execute(input) {
        const taskId = typeof input.task_id === 'string' ? input.task_id.trim() : '';
        if (!taskId) return 'Error: task_id 不能为空';

        const count = await reminders.cancelTaskChain(taskId, creatorUserId);
        if (count === 0) return `Error: 未找到可取消的任务 ${taskId}`;
        return JSON.stringify({ cancelledCount: count });
      },
    },
  ];
}

function presentReminder(reminder: Awaited<ReturnType<ReminderApi['listForCreator']>>[number]) {
  return {
    reminderId: reminder.reminderId,
    taskType: reminder.taskType,
    status: reminder.status,
    content: reminder.content,
    scheduleAt: reminder.scheduleAt,
    scheduleTime: formatReminderTime(reminder.scheduleAt, reminder.timezone),
    timezone: reminder.timezone,
    recurrence: reminder.recurrence,
    execution: reminder.execution,
    retryCount: reminder.retryCount,
    lastError: reminder.lastError,
  };
}