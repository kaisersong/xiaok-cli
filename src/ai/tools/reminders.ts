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
            request: { type: 'string', description: '自然语言提醒请求，例如“30分钟后提醒我发日报”' },
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
  ];
}

function presentReminder(reminder: Awaited<ReturnType<ReminderApi['listForCreator']>>[number]) {
  return {
    reminderId: reminder.reminderId,
    status: reminder.status,
    content: reminder.content,
    scheduleAt: reminder.scheduleAt,
    scheduleTime: formatReminderTime(reminder.scheduleAt, reminder.timezone),
    timezone: reminder.timezone,
    retryCount: reminder.retryCount,
    lastError: reminder.lastError,
  };
}
