import { InChatReminderNotifier, type ReminderSink } from './notifier.js';
import { parseReminderRequest } from './parser.js';
import { ReminderScheduler } from './scheduler.js';
import { SQLiteReminderStore } from './store.js';
import type { ReminderNotifier, ReminderRecord } from './types.js';

export interface ReminderServiceOptions {
  dbPath: string;
  now?: () => number;
  defaultTimeZone?: string;
  notifier?: ReminderNotifier;
  scanIntervalMs?: number;
  staleAfterMs?: number;
}

export interface CreateReminderFromRequestInput {
  sessionId: string;
  creatorUserId: string;
  request: string;
  timezone?: string;
  deliveryTarget?: Record<string, unknown>;
}

export interface CreateStructuredReminderInput {
  sessionId: string;
  creatorUserId: string;
  content: string;
  scheduleAt: string;
  timezone?: string;
  deliveryTarget?: Record<string, unknown>;
}

export type ReminderCreateResult =
  | { ok: true; reminder: ReminderRecord }
  | { ok: false; code: 'needs_confirmation' | 'invalid'; message: string };

export interface ReminderApi {
  readonly defaultTimeZone: string;
  start(): Promise<void>;
  registerInChatSink(sessionId: string, sink: ReminderSink): () => void;
  createFromRequest(input: CreateReminderFromRequestInput): ReminderCreateResult | Promise<ReminderCreateResult>;
  createStructured(input: CreateStructuredReminderInput): ReminderCreateResult | Promise<ReminderCreateResult>;
  listForCreator(sessionId: string, creatorUserId: string): ReminderRecord[] | Promise<ReminderRecord[]>;
  cancelForCreator(reminderId: string, creatorUserId: string): ReminderRecord | undefined | Promise<ReminderRecord | undefined>;
  dispose(): Promise<void>;
}

export class ReminderService {
  readonly store: SQLiteReminderStore;
  readonly defaultTimeZone: string;
  private readonly now: () => number;
  private readonly notifier: ReminderNotifier;
  private readonly scheduler: ReminderScheduler;

  constructor(options: ReminderServiceOptions) {
    this.store = new SQLiteReminderStore(options.dbPath);
    this.defaultTimeZone = options.defaultTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    this.now = options.now ?? (() => Date.now());
    this.notifier = options.notifier ?? new InChatReminderNotifier();
    this.scheduler = new ReminderScheduler({
      store: this.store,
      notifier: this.notifier,
      now: this.now,
      scanIntervalMs: options.scanIntervalMs,
      staleAfterMs: options.staleAfterMs,
    });
  }

  async start(): Promise<void> {
    await this.scheduler.start();
  }

  async runOnce(): Promise<void> {
    await this.scheduler.runOnce();
  }

  registerInChatSink(sessionId: string, sink: ReminderSink): () => void {
    if (this.notifier instanceof InChatReminderNotifier) {
      return this.notifier.register(sessionId, sink);
    }
    return () => undefined;
  }

  createFromRequest(input: CreateReminderFromRequestInput):
    | { ok: true; reminder: ReminderRecord }
    | { ok: false; code: 'needs_confirmation' | 'invalid'; message: string } {
    const timezone = input.timezone ?? this.defaultTimeZone;
    const parsed = parseReminderRequest(input.request, {
      now: this.now,
      timezone,
    });
    if (!parsed.ok) {
      return parsed;
    }

    return {
      ok: true,
      reminder: this.store.createReminder({
        sessionId: input.sessionId,
        creatorUserId: input.creatorUserId,
        content: parsed.content,
        scheduleAt: parsed.scheduleAt,
        timezone: parsed.timezone,
        channel: 'in_chat',
        deliveryPolicy: 'bound_session',
        deliveryTarget: input.deliveryTarget ?? { targetSessionId: input.sessionId },
      }),
    };
  }

  createStructured(input: CreateStructuredReminderInput):
    | { ok: true; reminder: ReminderRecord }
    | { ok: false; code: 'invalid'; message: string } {
    const timezone = input.timezone ?? this.defaultTimeZone;
    const scheduleAt = Date.parse(input.scheduleAt);
    if (!Number.isFinite(scheduleAt)) {
      return {
        ok: false,
        code: 'invalid',
        message: 'schedule_at 必须是可解析的时间字符串。',
      };
    }
    if (scheduleAt <= this.now()) {
      return {
        ok: false,
        code: 'invalid',
        message: '提醒时间必须晚于当前时间。',
      };
    }

    return {
      ok: true,
      reminder: this.store.createReminder({
        sessionId: input.sessionId,
        creatorUserId: input.creatorUserId,
        content: input.content.trim(),
        scheduleAt,
        timezone,
        channel: 'in_chat',
        deliveryPolicy: 'bound_session',
        deliveryTarget: input.deliveryTarget ?? { targetSessionId: input.sessionId },
      }),
    };
  }

  listForCreator(sessionId: string, creatorUserId: string): ReminderRecord[] {
    return this.store.listRemindersForCreator(sessionId, creatorUserId);
  }

  cancelForCreator(reminderId: string, creatorUserId: string): ReminderRecord | undefined {
    return this.store.cancelReminder(reminderId, creatorUserId, this.now());
  }

  async dispose(): Promise<void> {
    this.scheduler.stop();
    this.store.dispose();
  }
}

export function createReminderService(options: ReminderServiceOptions): ReminderService {
  return new ReminderService(options);
}

export function formatReminderTime(scheduleAt: number, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${formatter.format(new Date(scheduleAt)).replace(',', '')} (${timezone})`;
}
