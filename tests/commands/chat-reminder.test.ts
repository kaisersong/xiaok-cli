import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeReminderSlashCommand } from '../../src/commands/chat-reminder.js';
import { createReminderService } from '../../src/runtime/reminder/service.js';

describe('chat reminder slash commands', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates, lists, and cancels reminders through the unified /reminder command', async () => {
    const root = join(tmpdir(), `xiaok-chat-reminder-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(root);
    mkdirSync(root, { recursive: true });

    const reminders = createReminderService({
      dbPath: join(root, 'reminders.sqlite'),
      now: () => Date.UTC(2026, 3, 19, 1, 0, 0),
      defaultTimeZone: 'Asia/Shanghai',
    });

    const created = await executeReminderSlashCommand('/reminder 30分钟后提醒我发日报', {
      reminders,
      sessionId: 'sess_1',
      creatorUserId: 'sess_1',
    });

    expect(created).toContain('已创建提醒');
    expect(created).toContain('发日报');

    const listed = await executeReminderSlashCommand('/reminder list', {
      reminders,
      sessionId: 'sess_1',
      creatorUserId: 'sess_1',
    });

    expect(listed).toContain('当前会话提醒');
    expect(listed).toContain('发日报');

    const reminderId = (await reminders.listForCreator('sess_1', 'sess_1'))[0]!.reminderId;
    const cancelled = await executeReminderSlashCommand(`/reminder cancel ${reminderId}`, {
      reminders,
      sessionId: 'sess_1',
      creatorUserId: 'sess_1',
    });

    expect(cancelled).toContain('已取消提醒');
    expect(cancelled).toContain(reminderId);

    await reminders.dispose();
  });

  it('returns a user-facing clarification error for ambiguous reminder requests', async () => {
    const root = join(tmpdir(), `xiaok-chat-reminder-ambiguous-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(root);
    mkdirSync(root, { recursive: true });

    const reminders = createReminderService({
      dbPath: join(root, 'reminders.sqlite'),
      now: () => Date.UTC(2026, 3, 19, 1, 0, 0),
      defaultTimeZone: 'Asia/Shanghai',
    });

    const result = await executeReminderSlashCommand('/reminder 明早提醒我吃饭', {
      reminders,
      sessionId: 'sess_1',
      creatorUserId: 'sess_1',
    });

    expect(result).toContain('Error: 请提供明确的提醒时间');

    await reminders.dispose();
  });

  it('returns usage help for unsupported or incomplete /reminder subcommands', async () => {
    const root = join(tmpdir(), `xiaok-chat-reminder-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(root);
    mkdirSync(root, { recursive: true });

    const reminders = createReminderService({
      dbPath: join(root, 'reminders.sqlite'),
      now: () => Date.UTC(2026, 3, 19, 1, 0, 0),
      defaultTimeZone: 'Asia/Shanghai',
    });

    const empty = await executeReminderSlashCommand('/reminder', {
      reminders,
      sessionId: 'sess_1',
      creatorUserId: 'sess_1',
    });
    const cancelMissingId = await executeReminderSlashCommand('/reminder cancel', {
      reminders,
      sessionId: 'sess_1',
      creatorUserId: 'sess_1',
    });

    expect(empty).toContain('用法：/reminder <自然语言> | list | cancel <id>');
    expect(cancelMissingId).toContain('用法：/reminder <自然语言> | list | cancel <id>');

    await reminders.dispose();
  });
});
