import { formatReminderTime, type ReminderApi } from '../runtime/reminder/service.js';

export interface ChatReminderCommandContext {
  reminders: ReminderApi;
  sessionId: string;
  creatorUserId: string;
}

export const CHAT_REMINDER_SLASH_COMMANDS = [
  {
    cmd: '/reminder',
    desc: 'Manage reminders: create, list, or cancel',
    helpLine: '  /reminder <自然语言> | list | cancel <id> - 管理提醒',
  },
] as const;

type ReminderRecord = Awaited<ReturnType<ReminderApi['listForCreator']>>[number];

type ParsedReminderSlashCommand =
  | { kind: 'usage' }
  | { kind: 'create'; request: string }
  | { kind: 'list' }
  | { kind: 'cancel'; reminderId: string }
  | { kind: 'legacy'; message: string };

const REMINDER_USAGE = '用法：/reminder <自然语言> | list | cancel <id>';

export function buildChatReminderHelpLines(): string[] {
  return CHAT_REMINDER_SLASH_COMMANDS.map((command) => command.helpLine);
}

export async function executeReminderSlashCommand(
  trimmed: string,
  context: ChatReminderCommandContext,
): Promise<string | null> {
  const parsed = parseReminderSlashCommand(trimmed);
  if (!parsed) {
    return null;
  }

  if (parsed.kind === 'legacy') {
    return parsed.message;
  }

  if (parsed.kind === 'usage') {
    return REMINDER_USAGE;
  }

  if (parsed.kind === 'create') {
    const created = await context.reminders.createFromRequest({
      sessionId: context.sessionId,
      creatorUserId: context.creatorUserId,
      request: parsed.request,
    });

    if (!created.ok) {
      return `Error: ${created.message}`;
    }

    return ['已创建提醒：', formatReminderRow(created.reminder)].join('\n');
  }

  if (parsed.kind === 'list') {
    const remindersForSession = await context.reminders.listForCreator(context.sessionId, context.creatorUserId);
    if (remindersForSession.length === 0) {
      return '当前会话还没有提醒。';
    }

    return ['当前会话提醒：', ...remindersForSession.map(formatReminderRow)].join('\n');
  }

  const cancelled = await context.reminders.cancelForCreator(parsed.reminderId, context.creatorUserId);
  if (!cancelled) {
    return `未找到可取消的提醒 ${parsed.reminderId}`;
  }

  return ['已取消提醒：', formatReminderRow(cancelled)].join('\n');
}

function parseReminderSlashCommand(trimmed: string): ParsedReminderSlashCommand | null {
  if (trimmed === '/remind') {
    return { kind: 'legacy', message: '提醒命令已合并，请改用：/reminder <自然语言>' };
  }

  if (trimmed.startsWith('/remind ')) {
    return { kind: 'legacy', message: `提醒命令已合并，请改用：/reminder ${trimmed.slice('/remind '.length).trim()}` };
  }

  if (trimmed === '/reminders') {
    return { kind: 'legacy', message: '提醒命令已合并，请改用：/reminder list' };
  }

  if (trimmed === '/reminder-cancel') {
    return { kind: 'legacy', message: '提醒命令已合并，请改用：/reminder cancel <id>' };
  }

  if (trimmed.startsWith('/reminder-cancel ')) {
    return {
      kind: 'legacy',
      message: `提醒命令已合并，请改用：/reminder cancel ${trimmed.slice('/reminder-cancel '.length).trim()}`,
    };
  }

  if (trimmed === '/reminder') {
    return { kind: 'usage' };
  }

  if (!trimmed.startsWith('/reminder ')) {
    return null;
  }

  const args = trimmed.slice('/reminder '.length).trim();
  if (!args) {
    return { kind: 'usage' };
  }

  if (args === 'list') {
    return { kind: 'list' };
  }

  if (args === 'cancel') {
    return { kind: 'usage' };
  }

  if (args.startsWith('cancel ')) {
    const reminderId = args.slice('cancel '.length).trim();
    if (!reminderId) {
      return { kind: 'usage' };
    }
    return { kind: 'cancel', reminderId };
  }

  return { kind: 'create', request: args };
}

function formatReminderRow(reminder: ReminderRecord): string {
  return `  ${reminder.reminderId} [${reminder.status}] ${formatReminderTime(reminder.scheduleAt, reminder.timezone)} - ${reminder.content}`;
}
