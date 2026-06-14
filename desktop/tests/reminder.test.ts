import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonReminderStore, type ReminderRecord } from '../electron/reminder-store.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = '/tmp/xiaok-reminder-test';

function setupStore() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  const store = new JsonReminderStore(TEST_DIR);
  return { store, cleanup: () => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true }); } };
}

describe('JsonReminderStore', () => {
  let store: JsonReminderStore;
  let cleanup: () => void;

  beforeEach(() => {
    const { store: s, cleanup: c } = setupStore();
    store = s;
    cleanup = c;
  });

  afterEach(() => {
    cleanup();
  });

  describe('createReminder', () => {
    it('should create a reminder with correct fields', () => {
      const now = Date.now();
      const r = store.createReminder({
        content: 'Test reminder',
        scheduleAt: now + 60_000,
        timezone: 'Asia/Shanghai',
      });

      expect(r.reminderId).toBeDefined();
      expect(r.content).toBe('Test reminder');
      expect(r.scheduleAt).toBe(now + 60_000);
      expect(r.timezone).toBe('Asia/Shanghai');
      expect(r.status).toBe('pending');
      expect(r.retryCount).toBe(0);
      expect(r.maxRetry).toBe(5);
      expect(r.nextAttemptAt).toBe(now + 60_000);
      expect(r.createdAt).toBeGreaterThan(0);
      expect(r.updatedAt).toBeGreaterThan(0);
    });

    it('should persist reminder to disk', () => {
      store.createReminder({
        content: 'Persist test',
        scheduleAt: Date.now() + 60_000,
        timezone: 'UTC',
      });

      // Create new store instance and verify data loaded
      const store2 = new JsonReminderStore(TEST_DIR);
      const reminders = store2.listAll();
      expect(reminders).toHaveLength(1);
      expect(reminders[0].content).toBe('Persist test');
    });

    it('should handle empty file gracefully', () => {
      const store2 = new JsonReminderStore(TEST_DIR);
      expect(store2.listAll()).toHaveLength(0);
    });
  });

  describe('listActive', () => {
    it('should return only pending and delivering reminders', () => {
      const now = Date.now();
      store.createReminder({ content: 'pending', scheduleAt: now + 60_000, timezone: 'UTC' });
      store.createReminder({ content: 'sent', scheduleAt: now - 60_000, timezone: 'UTC' });

      // Manually mark one as sent
      const all = store.listAll();
      const sentOne = all.find((r: ReminderRecord) => r.content === 'sent')!;
      store.markSent(sentOne.reminderId, now);

      const active = store.listActive();
      expect(active).toHaveLength(1);
      expect(active[0].content).toBe('pending');
    });
  });

  describe('cancelReminder', () => {
    it('should cancel a pending reminder', () => {
      const r = store.createReminder({
        content: 'To cancel',
        scheduleAt: Date.now() + 60_000,
        timezone: 'UTC',
      });

      const result = store.cancelReminder(r.reminderId);
      expect(result).toBe(true);

      const cancelled = store.getReminder(r.reminderId)!;
      expect(cancelled.status).toBe('cancelled');
    });

    it('should return false for non-existent reminder', () => {
      expect(store.cancelReminder('non-existent')).toBe(false);
    });

    it('should not cancel already cancelled reminder', () => {
      const r = store.createReminder({
        content: 'Already cancelled',
        scheduleAt: Date.now() + 60_000,
        timezone: 'UTC',
      });
      store.cancelReminder(r.reminderId);
      expect(store.cancelReminder(r.reminderId)).toBe(false);
    });
  });

  describe('claimDueReminders', () => {
    it('should claim reminders that are due', () => {
      const now = Date.now();
      store.createReminder({ content: 'due', scheduleAt: now - 1000, timezone: 'UTC' });
      store.createReminder({ content: 'future', scheduleAt: now + 60_000, timezone: 'UTC' });

      const claimed = store.claimDueReminders(now, 10);
      expect(claimed).toHaveLength(1);
      expect(claimed[0].content).toBe('due');
      expect(claimed[0].status).toBe('delivering');
    });

    it('should respect limit', () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        store.createReminder({ content: `reminder-${i}`, scheduleAt: now - 1000, timezone: 'UTC' });
      }

      const claimed = store.claimDueReminders(now, 3);
      expect(claimed).toHaveLength(3);
    });

    it('should return empty when no reminders are due', () => {
      const now = Date.now();
      store.createReminder({ content: 'future', scheduleAt: now + 60_000, timezone: 'UTC' });

      const claimed = store.claimDueReminders(now, 10);
      expect(claimed).toHaveLength(0);
    });

    it('should sort by nextAttemptAt ascending', () => {
      const now = Date.now();
      store.createReminder({ content: 'later', scheduleAt: now - 2000, timezone: 'UTC' });
      store.createReminder({ content: 'sooner', scheduleAt: now - 3000, timezone: 'UTC' });

      const claimed = store.claimDueReminders(now, 10);
      expect(claimed[0].content).toBe('sooner');
      expect(claimed[1].content).toBe('later');
    });
  });

  describe('markSent', () => {
    it('should mark reminder as sent', () => {
      const r = store.createReminder({
        content: 'Test',
        scheduleAt: Date.now() - 1000,
        timezone: 'UTC',
      });
      store.claimDueReminders(Date.now(), 10);

      const now = Date.now();
      store.markSent(r.reminderId, now);

      const updated = store.getReminder(r.reminderId)!;
      expect(updated.status).toBe('sent');
      expect(updated.sentAt).toBe(now);
    });
  });

  describe('markFailed', () => {
    it('should retry when under max retry', () => {
      const r = store.createReminder({
        content: 'Test',
        scheduleAt: Date.now() - 1000,
        timezone: 'UTC',
      });
      store.claimDueReminders(Date.now(), 10);

      const now = Date.now();
      store.markFailed(r.reminderId, now, 'Network error');

      const updated = store.getReminder(r.reminderId)!;
      expect(updated.status).toBe('pending');
      expect(updated.retryCount).toBe(1);
      expect(updated.lastError).toBe('Network error');
      expect(updated.nextAttemptAt).toBeGreaterThan(now);
    });

    it('should mark as failed when max retry reached', () => {
      const r = store.createReminder({
        content: 'Test',
        scheduleAt: Date.now() - 1000,
        timezone: 'UTC',
      });
      store.claimDueReminders(Date.now(), 10);

      const now = Date.now();
      // Manually set retry count to max - 1
      const record = store.getReminder(r.reminderId)!;
      record.retryCount = 4;
      store.markFailed(r.reminderId, now, 'Final error');

      const updated = store.getReminder(r.reminderId)!;
      expect(updated.status).toBe('failed');
      expect(updated.retryCount).toBe(5);
    });
  });

  describe('recoverMissed', () => {
    it('should find missed reminders', () => {
      const now = Date.now();
      store.createReminder({ content: 'missed', scheduleAt: now - 60_000, timezone: 'UTC' });
      store.createReminder({ content: 'on-time', scheduleAt: now + 60_000, timezone: 'UTC' });

      const missed = store.recoverMissed(now);
      expect(missed).toHaveLength(1);
      expect(missed[0].content).toBe('missed');
    });
  });

  describe('recoverStaleDelivering', () => {
    it('should reset stale delivering states', () => {
      const now = Date.now();
      const r = store.createReminder({
        content: 'Stale',
        scheduleAt: now - 1000,
        timezone: 'UTC',
      });
      store.claimDueReminders(now, 10);

      // Simulate stale: manually set updatedAt to 10 minutes ago
      const record = store.getReminder(r.reminderId)!;
      record.updatedAt = now - 10 * 60_000;

      const recovered = store.recoverStaleDelivering(now, 5 * 60_000);
      expect(recovered).toHaveLength(1);
      expect(recovered[0].status).toBe('pending');
    });

    it('should not recover recent delivering states', () => {
      const now = Date.now();
      const r = store.createReminder({
        content: 'Fresh',
        scheduleAt: now - 1000,
        timezone: 'UTC',
      });
      store.claimDueReminders(now, 10);

      const recovered = store.recoverStaleDelivering(now, 5 * 60_000);
      expect(recovered).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('should remove old sent/failed reminders', () => {
      const now = Date.now();
      const oldTime = now - 8 * 24 * 60 * 60_000; // 8 days ago

      // Create old sent reminder
      const r1 = store.createReminder({ content: 'Old sent', scheduleAt: oldTime, timezone: 'UTC' });
      store.markSent(r1.reminderId, oldTime);

      // Create fresh pending reminder
      store.createReminder({ content: 'Fresh', scheduleAt: now + 60_000, timezone: 'UTC' });

      const removed = store.cleanup(7 * 24 * 60 * 60_000);
      expect(removed).toBe(1);
      expect(store.listAll()).toHaveLength(1);
    });
  });
});
