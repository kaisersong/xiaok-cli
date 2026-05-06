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

  it('persists taskType, recurrence, and execution fields for scheduled tasks', () => {
    const root = join(tmpdir(), `xiaok-task-store-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
    let store: SQLiteReminderStore | undefined;

    try {
      store = new SQLiteReminderStore(dbPath);
      const task = store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'sess_1',
        content: '每5分钟检查代理',
        scheduleAt: 1_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
        taskType: 'scheduled_task',
        recurrence: {
          type: 'interval',
          intervalMs: 300_000,
          maxOccurrences: 10,
          occurrenceCount: 0,
        },
        execution: {
          prompt: '检查美国代理节点可用性并生成报告',
        },
      });

      const loaded = store.getReminder(task.reminderId);
      expect(loaded?.taskType).toBe('scheduled_task');
      expect(loaded?.recurrence?.type).toBe('interval');
      expect(loaded?.recurrence?.intervalMs).toBe(300_000);
      expect(loaded?.recurrence?.maxOccurrences).toBe(10);
      expect(loaded?.execution?.prompt).toBe('检查美国代理节点可用性并生成报告');
    } finally {
      store?.dispose();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  });

  it('clones next occurrence after marking a recurring task as sent', () => {
    const root = join(tmpdir(), `xiaok-task-clone-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
    let store: SQLiteReminderStore | undefined;

    try {
      store = new SQLiteReminderStore(dbPath);
      const task = store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'sess_1',
        content: '定时检查',
        scheduleAt: 1_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
        taskType: 'scheduled_task',
        recurrence: {
          type: 'interval',
          intervalMs: 60_000,
          maxOccurrences: 3,
          occurrenceCount: 0,
        },
      });

      store.markReminderSent(task.reminderId, 2_000);
      const clone = store.cloneNextOccurrence(task.reminderId, 2_000);

      expect(clone).toBeDefined();
      expect(clone?.scheduleAt).toBe(1_000 + 60_000);
      expect(clone?.recurrence?.occurrenceCount).toBe(1);
      expect(clone?.status).toBe('pending');
      expect(clone?.taskType).toBe('scheduled_task');
    } finally {
      store?.dispose();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  });

  it('stops cloning when maxOccurrences is reached', () => {
    const root = join(tmpdir(), `xiaok-task-max-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
    let store: SQLiteReminderStore | undefined;

    try {
      store = new SQLiteReminderStore(dbPath);
      const task = store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'sess_1',
        content: '有限次数任务',
        scheduleAt: 1_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
        taskType: 'scheduled_task',
        recurrence: {
          type: 'interval',
          intervalMs: 60_000,
          maxOccurrences: 1,
          occurrenceCount: 0,
        },
      });

      store.markReminderSent(task.reminderId, 2_000);
      const clone = store.cloneNextOccurrence(task.reminderId, 2_000);

      expect(clone).toBeUndefined();
    } finally {
      store?.dispose();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  });

  it('cancels a task chain including future occurrences', () => {
    const root = join(tmpdir(), `xiaok-task-cancel-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
    let store: SQLiteReminderStore | undefined;

    try {
      store = new SQLiteReminderStore(dbPath);
      const task1 = store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'user_1',
        content: '定时任务A',
        scheduleAt: 1_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
        taskType: 'scheduled_task',
        recurrence: {
          type: 'interval',
          intervalMs: 60_000,
          occurrenceCount: 0,
        },
      });
      const task2 = store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'user_1',
        content: '定时任务A',
        scheduleAt: 61_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
        taskType: 'scheduled_task',
        recurrence: {
          type: 'interval',
          intervalMs: 60_000,
          occurrenceCount: 1,
        },
      });

      const cancelledCount = store.cancelTaskChain(task1.reminderId, 'user_1', 5_000);

      expect(cancelledCount).toBe(2);
      expect(store.getReminder(task1.reminderId)?.status).toBe('cancelled');
      expect(store.getReminder(task2.reminderId)?.status).toBe('cancelled');
    } finally {
      store?.dispose();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  });

  it('lists only scheduled_task records when filtering by task type', () => {
    const root = join(tmpdir(), `xiaok-task-list-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'reminders.sqlite');
    let store: SQLiteReminderStore | undefined;

    try {
      store = new SQLiteReminderStore(dbPath);
      store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'user_1',
        content: '普通提醒',
        scheduleAt: 1_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
        taskType: 'reminder',
      });
      store.createReminder({
        sessionId: 'sess_1',
        creatorUserId: 'user_1',
        content: '定时任务',
        scheduleAt: 2_000,
        timezone: 'Asia/Shanghai',
        channel: 'in_chat',
        deliveryTarget: { sessionId: 'sess_1' },
        taskType: 'scheduled_task',
      });

      const tasks = store.listTasksForCreator('sess_1', 'user_1');
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.taskType).toBe('scheduled_task');
      expect(tasks[0]?.content).toBe('定时任务');
    } finally {
      store?.dispose();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  });
});
