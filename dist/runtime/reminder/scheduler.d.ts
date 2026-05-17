import type { ReminderNotifier } from './types.js';
import { SQLiteReminderStore } from './store.js';
export interface ReminderSchedulerOptions {
    store: SQLiteReminderStore;
    notifier: ReminderNotifier;
    now?: () => number;
    scanIntervalMs?: number;
    batchSize?: number;
    staleAfterMs?: number;
    retryDelaysMs?: readonly number[];
}
export declare class ReminderScheduler {
    private readonly options;
    private readonly now;
    private readonly scanIntervalMs;
    private readonly batchSize;
    private readonly staleAfterMs;
    private readonly retryDelaysMs;
    private timer;
    constructor(options: ReminderSchedulerOptions);
    start(): Promise<void>;
    stop(): void;
    runOnce(): Promise<void>;
}
