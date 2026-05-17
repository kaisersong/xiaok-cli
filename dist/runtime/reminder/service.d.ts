import { type ReminderSink } from './notifier.js';
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
    taskType?: 'reminder' | 'scheduled_task';
    recurrence?: {
        type: 'interval';
        intervalMs: number;
        maxOccurrences?: number;
        occurrenceCount: number;
    };
    execution?: {
        prompt: string;
    };
}
export type ReminderCreateResult = {
    ok: true;
    reminder: ReminderRecord;
} | {
    ok: false;
    code: 'needs_confirmation' | 'invalid';
    message: string;
};
export interface ReminderApi {
    readonly defaultTimeZone: string;
    start(): Promise<void>;
    registerInChatSink(sessionId: string, sink: ReminderSink): () => void;
    createFromRequest(input: CreateReminderFromRequestInput): ReminderCreateResult | Promise<ReminderCreateResult>;
    createStructured(input: CreateStructuredReminderInput): ReminderCreateResult | Promise<ReminderCreateResult>;
    listForCreator(sessionId: string, creatorUserId: string): ReminderRecord[] | Promise<ReminderRecord[]>;
    listTasksForCreator(sessionId: string, creatorUserId: string): ReminderRecord[] | Promise<ReminderRecord[]>;
    cancelForCreator(reminderId: string, creatorUserId: string): ReminderRecord | undefined | Promise<ReminderRecord | undefined>;
    cancelTaskChain(taskId: string, creatorUserId: string): number | Promise<number>;
    dispose(): Promise<void>;
}
export declare class ReminderService {
    readonly store: SQLiteReminderStore;
    readonly defaultTimeZone: string;
    private readonly now;
    private readonly notifier;
    private readonly scheduler;
    constructor(options: ReminderServiceOptions);
    start(): Promise<void>;
    runOnce(): Promise<void>;
    registerInChatSink(sessionId: string, sink: ReminderSink): () => void;
    createFromRequest(input: CreateReminderFromRequestInput): {
        ok: true;
        reminder: ReminderRecord;
    } | {
        ok: false;
        code: 'needs_confirmation' | 'invalid';
        message: string;
    };
    createStructured(input: CreateStructuredReminderInput): {
        ok: true;
        reminder: ReminderRecord;
    } | {
        ok: false;
        code: 'invalid';
        message: string;
    };
    listForCreator(sessionId: string, creatorUserId: string): ReminderRecord[];
    listTasksForCreator(sessionId: string, creatorUserId: string): ReminderRecord[];
    cancelForCreator(reminderId: string, creatorUserId: string): ReminderRecord | undefined;
    cancelTaskChain(taskId: string, creatorUserId: string): number;
    dispose(): Promise<void>;
}
export declare function createReminderService(options: ReminderServiceOptions): ReminderService;
export declare function formatReminderTime(scheduleAt: number, timezone: string): string;
