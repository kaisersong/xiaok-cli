import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  CreateReminderInput,
  ReminderDeliveryPolicy,
  ReminderDeliveryRecord,
  ReminderRecord,
  ReminderStatus,
} from './types.js';

const REMINDER_SCHEMA_VERSION = 2;

interface ReminderRow {
  reminder_id: string;
  session_id: string;
  creator_user_id: string;
  content: string;
  schedule_at: number;
  timezone: string;
  channel: string;
  delivery_policy: ReminderDeliveryPolicy;
  delivery_target: string;
  status: ReminderStatus;
  idempotency_key: string;
  retry_count: number;
  max_retry: number;
  next_attempt_at: number;
  last_attempt_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
  cancelled_at: number | null;
}

interface DeliveryRow {
  attempt_id: string;
  reminder_id: string;
  channel: string;
  idempotency_key: string;
  status: 'sending' | 'sent' | 'failed';
  provider_message_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
}

type RowInfo = {
  name: string;
};

export class SQLiteReminderStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminder_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reminders (
        reminder_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        creator_user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        schedule_at INTEGER NOT NULL,
        timezone TEXT NOT NULL,
        channel TEXT NOT NULL,
        delivery_target TEXT NOT NULL,
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        retry_count INTEGER NOT NULL,
        max_retry INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL,
        last_attempt_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sent_at INTEGER,
        cancelled_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS reminder_deliveries (
        attempt_id TEXT PRIMARY KEY,
        reminder_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_message_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sent_at INTEGER
      );
    `);
    this.migrateSchema();
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_reminders_session ON reminders(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reminders_creator ON reminders(creator_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deliveries_reminder ON reminder_deliveries(reminder_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deliveries_idempotency ON reminder_deliveries(idempotency_key, status);
    `);
  }

  getSchemaVersion(): number {
    const row = this.db.prepare(`
      SELECT value
      FROM reminder_meta
      WHERE key = 'schema_version'
    `).get() as { value?: string } | undefined;
    const value = Number(row?.value ?? '0');
    return Number.isFinite(value) ? value : 0;
  }

  createReminder(input: CreateReminderInput): ReminderRecord {
    const now = Date.now();
    const reminderId = randomUUID();
    const idempotencyKey = `reminder:${reminderId}`;
    this.db.prepare(`
      INSERT INTO reminders (
        reminder_id, session_id, creator_user_id, content, schedule_at, timezone, channel, delivery_policy, delivery_target,
        status, idempotency_key, retry_count, max_retry, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?, ?)
    `).run(
      reminderId,
      input.sessionId,
      input.creatorUserId,
      input.content,
      input.scheduleAt,
      input.timezone,
      input.channel,
      input.deliveryPolicy ?? 'bound_session',
      JSON.stringify(input.deliveryTarget),
      idempotencyKey,
      input.maxRetry ?? 5,
      input.scheduleAt,
      now,
      now,
    );
    return this.getReminder(reminderId)!;
  }

  getReminder(reminderId: string): ReminderRecord | undefined {
    const row = this.db.prepare('SELECT * FROM reminders WHERE reminder_id = ?').get(reminderId) as ReminderRow | undefined;
    return row ? mapReminder(row) : undefined;
  }

  listRemindersForCreator(sessionId: string, creatorUserId: string, limit = 20): ReminderRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM reminders
      WHERE session_id = ? AND creator_user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, creatorUserId, limit) as ReminderRow[];
    return rows.map(mapReminder);
  }

  cancelReminder(reminderId: string, creatorUserId: string, now: number): ReminderRecord | undefined {
    const result = this.db.prepare(`
      UPDATE reminders
      SET status = 'cancelled', cancelled_at = ?, updated_at = ?
      WHERE reminder_id = ?
        AND creator_user_id = ?
        AND status IN ('pending', 'retry_wait')
    `).run(now, now, reminderId, creatorUserId);
    if (result.changes === 0) {
      return undefined;
    }
    return this.getReminder(reminderId);
  }

  claimDueReminders(now: number, limit: number): ReminderRecord[] {
    const rows = this.db.prepare(`
      SELECT reminder_id FROM reminders
      WHERE status IN ('pending', 'retry_wait') AND next_attempt_at <= ?
      ORDER BY next_attempt_at ASC, created_at ASC
      LIMIT ?
    `).all(now, limit) as Array<{ reminder_id: string }>;

    const claimed: ReminderRecord[] = [];
    for (const row of rows) {
      const result = this.db.prepare(`
        UPDATE reminders
        SET status = 'delivering', last_attempt_at = ?, updated_at = ?
        WHERE reminder_id = ?
          AND status IN ('pending', 'retry_wait')
          AND next_attempt_at <= ?
      `).run(now, now, row.reminder_id, now);
      if (result.changes > 0) {
        const reminder = this.getReminder(row.reminder_id);
        if (reminder) {
          claimed.push(reminder);
        }
      }
    }

    return claimed;
  }

  createDeliveryAttempt(reminderId: string, now: number): ReminderDeliveryRecord {
    const reminder = this.getReminder(reminderId);
    if (!reminder) {
      throw new Error(`unknown reminder: ${reminderId}`);
    }
    const attemptId = randomUUID();
    this.db.prepare(`
      INSERT INTO reminder_deliveries (
        attempt_id, reminder_id, channel, idempotency_key, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'sending', ?, ?)
    `).run(attemptId, reminderId, reminder.channel, reminder.idempotencyKey, now, now);
    return this.getDelivery(attemptId)!;
  }

  getDelivery(attemptId: string): ReminderDeliveryRecord | undefined {
    const row = this.db.prepare('SELECT * FROM reminder_deliveries WHERE attempt_id = ?').get(attemptId) as DeliveryRow | undefined;
    return row ? mapDelivery(row) : undefined;
  }

  listDeliveries(reminderId: string): ReminderDeliveryRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM reminder_deliveries
      WHERE reminder_id = ?
      ORDER BY created_at DESC
    `).all(reminderId) as DeliveryRow[];
    return rows.map(mapDelivery);
  }

  hasSentDelivery(reminderId: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 AS sent
      FROM reminder_deliveries
      WHERE reminder_id = ? AND status = 'sent'
      LIMIT 1
    `).get(reminderId) as { sent: number } | undefined;
    return Boolean(row?.sent);
  }

  markDeliverySent(attemptId: string, now: number, providerMessageId?: string): void {
    this.db.prepare(`
      UPDATE reminder_deliveries
      SET status = 'sent', provider_message_id = ?, sent_at = ?, updated_at = ?, error = NULL
      WHERE attempt_id = ?
    `).run(providerMessageId ?? null, now, now, attemptId);
  }

  markDeliveryFailed(attemptId: string, now: number, error: string): void {
    this.db.prepare(`
      UPDATE reminder_deliveries
      SET status = 'failed', error = ?, updated_at = ?
      WHERE attempt_id = ?
    `).run(error, now, attemptId);
  }

  markReminderSent(reminderId: string, now: number): void {
    this.db.prepare(`
      UPDATE reminders
      SET status = 'sent', sent_at = ?, updated_at = ?, last_error = NULL
      WHERE reminder_id = ?
    `).run(now, now, reminderId);
  }

  markReminderRetry(reminderId: string, now: number, nextAttemptAt: number, error: string): void {
    this.db.prepare(`
      UPDATE reminders
      SET status = 'retry_wait',
          retry_count = retry_count + 1,
          next_attempt_at = ?,
          last_error = ?,
          updated_at = ?
      WHERE reminder_id = ?
    `).run(nextAttemptAt, error, now, reminderId);
  }

  markReminderFailed(reminderId: string, now: number, error: string): void {
    this.db.prepare(`
      UPDATE reminders
      SET status = 'failed',
          retry_count = retry_count + 1,
          last_error = ?,
          updated_at = ?
      WHERE reminder_id = ?
    `).run(error, now, reminderId);
  }

  recoverStaleDelivering(now: number, staleAfterMs: number): number {
    const rows = this.db.prepare(`
      SELECT reminder_id FROM reminders
      WHERE status = 'delivering' AND updated_at <= ?
    `).all(now - staleAfterMs) as Array<{ reminder_id: string }>;

    let recovered = 0;
    for (const row of rows) {
      if (this.hasSentDelivery(row.reminder_id)) {
        this.markReminderSent(row.reminder_id, now);
        recovered += 1;
        continue;
      }

      const result = this.db.prepare(`
        UPDATE reminders
        SET status = 'retry_wait',
            next_attempt_at = ?,
            last_error = ?,
            updated_at = ?
        WHERE reminder_id = ? AND status = 'delivering'
      `).run(now, 'delivery interrupted by process restart', now, row.reminder_id);
      recovered += Number(result.changes > 0);
    }

    return recovered;
  }

  dispose(): void {
    this.db.close();
  }

  private migrateSchema(): void {
    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(reminders)').all() as RowInfo[]).map((row) => row.name),
    );

    if (!columns.has('delivery_policy')) {
      this.db.exec(`
        ALTER TABLE reminders
        ADD COLUMN delivery_policy TEXT NOT NULL DEFAULT 'bound_session'
      `);
    }

    this.db.prepare(`
      INSERT INTO reminder_meta(key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(REMINDER_SCHEMA_VERSION));
  }
}

function mapReminder(row: ReminderRow): ReminderRecord {
  return {
    reminderId: row.reminder_id,
    sessionId: row.session_id,
    creatorUserId: row.creator_user_id,
    content: row.content,
    scheduleAt: row.schedule_at,
    timezone: row.timezone,
    channel: row.channel as 'in_chat',
    deliveryPolicy: row.delivery_policy ?? 'bound_session',
    deliveryTarget: JSON.parse(row.delivery_target) as Record<string, unknown>,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    retryCount: row.retry_count,
    maxRetry: row.max_retry,
    nextAttemptAt: row.next_attempt_at,
    lastAttemptAt: row.last_attempt_at ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
  };
}

function mapDelivery(row: DeliveryRow): ReminderDeliveryRecord {
  return {
    attemptId: row.attempt_id,
    reminderId: row.reminder_id,
    channel: row.channel as 'in_chat',
    idempotencyKey: row.idempotency_key,
    status: row.status,
    providerMessageId: row.provider_message_id ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at ?? undefined,
  };
}
