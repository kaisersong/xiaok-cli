import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export interface ReminderRecord {
  reminderId: string;
  content: string;
  scheduleAt: number;
  timezone: string;
  status: 'pending' | 'delivering' | 'sent' | 'failed' | 'cancelled';
  retryCount: number;
  maxRetry: number;
  nextAttemptAt: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  sentAt?: number;
}

export interface ReminderStoreData {
  reminders: ReminderRecord[];
}

export class JsonReminderStore {
  private filePath: string;
  private data: ReminderStoreData;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'reminders.json');
    mkdirSync(dataDir, { recursive: true });
    this.data = this.load();
  }

  private load(): ReminderStoreData {
    if (!existsSync(this.filePath)) {
      return { reminders: [] };
    }
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return { reminders: [] };
    }
  }

  private save(): void {
    const tmpPath = this.filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(this.data, null, 2));
    renameSync(tmpPath, this.filePath);
  }

  createReminder(input: {
    content: string;
    scheduleAt: number;
    timezone: string;
  }): ReminderRecord {
    const now = Date.now();
    const reminder: ReminderRecord = {
      reminderId: crypto.randomUUID(),
      content: input.content,
      scheduleAt: input.scheduleAt,
      timezone: input.timezone,
      status: 'pending',
      retryCount: 0,
      maxRetry: 5,
      nextAttemptAt: input.scheduleAt,
      createdAt: now,
      updatedAt: now,
    };
    this.data.reminders.push(reminder);
    this.save();
    return reminder;
  }

  getReminder(id: string): ReminderRecord | undefined {
    return this.data.reminders.find(r => r.reminderId === id);
  }

  listActive(): ReminderRecord[] {
    return this.data.reminders.filter(r => r.status === 'pending' || r.status === 'delivering');
  }

  listAll(): ReminderRecord[] {
    return [...this.data.reminders];
  }

  cancelReminder(id: string): boolean {
    const r = this.data.reminders.find(r => r.reminderId === id);
    if (!r || r.status !== 'pending') return false;
    r.status = 'cancelled';
    r.updatedAt = Date.now();
    this.save();
    return true;
  }

  claimDueReminders(now: number, limit: number): ReminderRecord[] {
    const due = this.data.reminders
      .filter(r => (r.status === 'pending' || r.status === 'delivering') && r.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, limit);

    const claimed: ReminderRecord[] = [];
    for (const r of due) {
      if (r.status === 'pending' || r.status === 'delivering') {
        r.status = 'delivering';
        r.updatedAt = now;
        claimed.push({ ...r });
      }
    }
    if (claimed.length > 0) this.save();
    return claimed;
  }

  markSent(id: string, now: number): void {
    const r = this.data.reminders.find(r => r.reminderId === id);
    if (r) {
      r.status = 'sent';
      r.sentAt = now;
      r.updatedAt = now;
      this.save();
    }
  }

  markFailed(id: string, now: number, error: string): void {
    const r = this.data.reminders.find(r => r.reminderId === id);
    if (r) {
      r.retryCount += 1;
      r.lastError = error;
      r.updatedAt = now;
      if (r.retryCount >= r.maxRetry) {
        r.status = 'failed';
      } else {
        r.status = 'pending';
        r.nextAttemptAt = now + Math.min(60_000 * Math.pow(2, r.retryCount), 30 * 60_000);
      }
      this.save();
    }
  }

  // Recovery: find reminders that should have fired but didn't
  recoverMissed(now: number): ReminderRecord[] {
    const missed = this.data.reminders
      .filter(r => r.status === 'pending' && r.nextAttemptAt <= now);
    return missed;
  }

  // Recovery: reset stale 'delivering' states
  recoverStaleDelivering(now: number, staleAfterMs: number): ReminderRecord[] {
    const stale = this.data.reminders
      .filter(r => r.status === 'delivering' && r.updatedAt <= now - staleAfterMs);
    for (const r of stale) {
      r.status = 'pending';
      r.nextAttemptAt = now;
      r.updatedAt = now;
      r.lastError = r.lastError ? `${r.lastError}; delivery interrupted` : 'delivery interrupted';
    }
    if (stale.length > 0) this.save();
    return stale;
  }

  // Clean up old sent/failed reminders
  cleanup(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const before = this.data.reminders.length;
    this.data.reminders = this.data.reminders.filter(r =>
      (r.status === 'pending' || r.status === 'delivering') || r.updatedAt > cutoff
    );
    const removed = before - this.data.reminders.length;
    if (removed > 0) this.save();
    return removed;
  }
}
