import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createReminderTools } from '../../../src/ai/tools/reminders.js';
import { createReminderService } from '../../../src/runtime/reminder/service.js';

describe('reminder tools', () => {
  it('creates, lists, and cancels reminders for the current session', async () => {
    const root = join(tmpdir(), `xiaok-reminder-tools-${Date.now()}`);
    mkdirSync(root, { recursive: true });

    try {
      const service = createReminderService({
        dbPath: join(root, 'reminders.sqlite'),
        now: () => Date.UTC(2026, 3, 19, 1, 0, 0),
      });
      const tools = new Map(
        createReminderTools({
          reminders: service,
          sessionId: 'sess_1',
          creatorUserId: 'sess_1',
          timezone: 'Asia/Shanghai',
        }).map((tool) => [tool.definition.name, tool]),
      );

      const createdJson = await tools.get('reminder_create')!.execute({
        request: '30分钟后提醒我发日报',
      });
      const created = JSON.parse(createdJson) as { reminderId: string; status: string; content: string };

      expect(created).toMatchObject({
        status: 'pending',
        content: '发日报',
      });

      const listed = JSON.parse(await tools.get('reminder_list')!.execute({})) as Array<{ reminderId: string }>;
      expect(listed.map((entry) => entry.reminderId)).toEqual([created.reminderId]);

      const cancelled = JSON.parse(await tools.get('reminder_cancel')!.execute({
        reminder_id: created.reminderId,
      })) as { status: string };
      expect(cancelled.status).toBe('cancelled');

      await service.dispose();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns a user-facing error when the reminder request is ambiguous', async () => {
    const root = join(tmpdir(), `xiaok-reminder-tools-ambiguous-${Date.now()}`);
    mkdirSync(root, { recursive: true });

    try {
      const service = createReminderService({
        dbPath: join(root, 'reminders.sqlite'),
        now: () => Date.UTC(2026, 3, 19, 1, 0, 0),
      });
      const tools = new Map(
        createReminderTools({
          reminders: service,
          sessionId: 'sess_1',
          creatorUserId: 'sess_1',
          timezone: 'Asia/Shanghai',
        }).map((tool) => [tool.definition.name, tool]),
      );

      await expect(tools.get('reminder_create')!.execute({
        request: '明早提醒我吃饭',
      })).resolves.toContain('Error: 请提供明确的提醒时间');

      await service.dispose();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
