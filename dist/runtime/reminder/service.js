import { InChatReminderNotifier } from './notifier.js';
import { parseReminderRequest } from './parser.js';
import { ReminderScheduler } from './scheduler.js';
import { SQLiteReminderStore } from './store.js';
export class ReminderService {
    store;
    defaultTimeZone;
    now;
    notifier;
    scheduler;
    constructor(options) {
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
    async start() {
        await this.scheduler.start();
    }
    async runOnce() {
        await this.scheduler.runOnce();
    }
    registerInChatSink(sessionId, sink) {
        if (this.notifier instanceof InChatReminderNotifier) {
            return this.notifier.register(sessionId, sink);
        }
        return () => undefined;
    }
    createFromRequest(input) {
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
    createStructured(input) {
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
                taskType: input.taskType ?? 'reminder',
                recurrence: input.recurrence,
                execution: input.execution,
            }),
        };
    }
    listForCreator(sessionId, creatorUserId) {
        return this.store.listRemindersForCreator(sessionId, creatorUserId);
    }
    listTasksForCreator(sessionId, creatorUserId) {
        return this.store.listTasksForCreator(sessionId, creatorUserId);
    }
    cancelForCreator(reminderId, creatorUserId) {
        return this.store.cancelReminder(reminderId, creatorUserId, this.now());
    }
    cancelTaskChain(taskId, creatorUserId) {
        return this.store.cancelTaskChain(taskId, creatorUserId, this.now());
    }
    async dispose() {
        this.scheduler.stop();
        this.store.dispose();
    }
}
export function createReminderService(options) {
    return new ReminderService(options);
}
export function formatReminderTime(scheduleAt, timezone) {
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
