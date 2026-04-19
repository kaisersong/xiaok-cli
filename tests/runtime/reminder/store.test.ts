import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQLiteReminderStore } from '../../../src/runtime/reminder/store.js';

describe('sqlite reminder store', () => {
  it('persists reminders across store instances', () => {
    const root = join(tmpdir(), `xiaok-reminder-store-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
    let store: SQLiteReminderStore | undefined;
    let reloaded: SQLiteReminderStore | undefined;

    try {
      store = new SQLiteReminderStore(dbPath);
      const reminder = store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'sess_1',
        content: '发日报',
        scheduleAt: 1_710_000_000_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
      });

      reloaded = new SQLiteReminderStore(dbPath);
      expect(reloaded.getReminder(reminder.reminderId)).toMatchObject({
        reminderId: reminder.reminderId,
        content: '发日报',
        status: 'pending',
        idempotencyKey: `reminder:${reminder.reminderId}`,
      });
    } finally {
      reloaded?.dispose();
      store?.dispose();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Windows + node:sqlite can keep a transient file lock after close.
      }
    }
  });

  it('claims only due reminders once and leaves future reminders untouched', () => {
    const root = join(tmpdir(), `xiaok-reminder-store-claim-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
    let store: SQLiteReminderStore | undefined;

    try {
      store = new SQLiteReminderStore(dbPath);
      const due = store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'sess_1',
        content: '发日报',
        scheduleAt: 1_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
      });
      store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'sess_1',
        content: '开会',
        scheduleAt: 5_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
      });

      const claimed = store.claimDueReminders(2_000, 10);
      expect(claimed.map((entry) => entry.reminderId)).toEqual([due.reminderId]);
      expect(store.claimDueReminders(2_000, 10)).toEqual([]);
      expect(store.getReminder(due.reminderId)?.status).toBe('delivering');
    } finally {
      store?.dispose();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Windows + node:sqlite can keep a transient file lock after close.
      }
    }
  });

  it('recovers stale delivering reminders to sent when a sent delivery already exists', () => {
    const root = join(tmpdir(), `xiaok-reminder-store-recovery-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
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

      const claimed = store.claimDueReminders(1_000, 1)[0];
      const attempt = store.createDeliveryAttempt(claimed.reminderId, 1_000);
      store.markDeliverySent(attempt.attemptId, 1_100, 'msg_1');

      const recovered = store.recoverStaleDelivering(20_000, 5_000);
      expect(recovered).toBe(1);
      expect(store.getReminder(reminder.reminderId)).toMatchObject({
        status: 'sent',
        sentAt: 20_000,
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
});
