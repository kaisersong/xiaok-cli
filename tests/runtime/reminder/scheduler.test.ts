import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReminderDeliveryError } from '../../../src/runtime/reminder/errors.js';
import { ReminderScheduler } from '../../../src/runtime/reminder/scheduler.js';
import { SQLiteReminderStore } from '../../../src/runtime/reminder/store.js';

describe('reminder scheduler', () => {
  it('delivers due reminders and marks them as sent', async () => {
    const root = join(tmpdir(), `xiaok-reminder-scheduler-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
    const delivered: string[] = [];
    let store: SQLiteReminderStore | undefined;

    try {
      store = new SQLiteReminderStore(dbPath);
      const reminder = store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'sess_1',
        content: '发日报',
        scheduleAt: 1_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
      });
      const scheduler = new ReminderScheduler({
        store,
        now: () => 1_000,
        notifier: {
          async deliver(reminderToDeliver) {
            delivered.push(reminderToDeliver.content);
            return { providerMessageId: `sent:${reminderToDeliver.reminderId}` };
          },
        },
      });

      await scheduler.runOnce();

      expect(delivered).toEqual(['发日报']);
      expect(store.getReminder(reminder.reminderId)).toMatchObject({
        status: 'sent',
        retryCount: 0,
      });
      expect(store.listDeliveries(reminder.reminderId)).toEqual([
        expect.objectContaining({
          status: 'sent',
          providerMessageId: `sent:${reminder.reminderId}`,
        }),
      ]);
    } finally {
      store?.dispose();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Windows + node:sqlite can keep a transient file lock after close.
      }
    }
  });

  it('moves failed deliveries into retry_wait with exponential backoff semantics from the policy table', async () => {
    const root = join(tmpdir(), `xiaok-reminder-scheduler-retry-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
    let now = 1_000;
    let attempts = 0;
    let store: SQLiteReminderStore | undefined;

    try {
      store = new SQLiteReminderStore(dbPath);
      const reminder = store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'sess_1',
        content: '发日报',
        scheduleAt: now,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
      });
      const scheduler = new ReminderScheduler({
        store,
        now: () => now,
        notifier: {
          async deliver() {
            attempts += 1;
            if (attempts === 1) {
              throw new Error('network timeout');
            }
            return { providerMessageId: 'msg_2' };
          },
        },
      });

      await scheduler.runOnce();
      expect(store.getReminder(reminder.reminderId)).toMatchObject({
        status: 'retry_wait',
        retryCount: 1,
        nextAttemptAt: 61_000,
        lastError: 'network timeout',
      });

      now = 61_000;
      await scheduler.runOnce();
      expect(store.getReminder(reminder.reminderId)).toMatchObject({
        status: 'sent',
        retryCount: 1,
      });
    } finally {
      store?.dispose();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Windows + node:sqlite can keep a transient file lock after close.
      }
    }
  });

  it('marks bound-session reminders as failed without retry when the target session is offline', async () => {
    const root = join(tmpdir(), `xiaok-reminder-scheduler-offline-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
    let store: SQLiteReminderStore | undefined;

    try {
      store = new SQLiteReminderStore(dbPath);
      const reminder = store.createReminder({
        sessionId: 'sess_missing',
        creatorUserId: 'sess_missing',
        content: '发日报',
        scheduleAt: 1_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { targetSessionId: 'sess_missing' },
      });
      const scheduler = new ReminderScheduler({
        store,
        now: () => 1_000,
        notifier: {
          async deliver() {
            throw new ReminderDeliveryError('target session offline', { retryable: false });
          },
        },
      });

      await scheduler.runOnce();

      expect(store.getReminder(reminder.reminderId)).toMatchObject({
        status: 'failed',
        retryCount: 1,
        lastError: 'target session offline',
      });
      expect(store.listDeliveries(reminder.reminderId)).toEqual([
        expect.objectContaining({
          status: 'failed',
          error: 'target session offline',
        }),
      ]);
    } finally {
      store?.dispose();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Windows + sqlite can keep a transient file lock after close.
      }
    }
  });

  it('clones next occurrence for recurring tasks after successful delivery', async () => {
    const root = join(tmpdir(), `xiaok-scheduler-recur-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
    let store: SQLiteReminderStore | undefined;

    try {
      store = new SQLiteReminderStore(dbPath);
      const task = store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'user_1',
        content: '定时检查',
        scheduleAt: 1_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { targetSessionId: 'sess_1' },
        taskType: 'scheduled_task',
        recurrence: {
          type: 'interval',
          intervalMs: 60_000,
          maxOccurrences: 5,
          occurrenceCount: 0,
        },
      });
      const scheduler = new ReminderScheduler({
        store,
        now: () => 2_000,
        notifier: {
          async deliver() {
            return {};
          },
        },
      });

      await scheduler.runOnce();

      expect(store.getReminder(task.reminderId)?.status).toBe('sent');

      const allTasks = store.listTasksForCreator('sess_1', 'user_1');
      const clone = allTasks.find((t) => t.status === 'pending');
      expect(clone).toBeDefined();
      expect(clone?.scheduleAt).toBe(1_000 + 60_000);
      expect(clone?.recurrence?.occurrenceCount).toBe(1);
      expect(clone?.status).toBe('pending');
    } finally {
      store?.dispose();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  });
});
