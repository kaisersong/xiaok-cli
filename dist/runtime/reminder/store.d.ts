import type { CreateReminderInput, ReminderDeliveryRecord, ReminderRecord } from './types.js';
export declare class SQLiteReminderStore {
    private readonly db;
    constructor(dbPath: string);
    getSchemaVersion(): number;
    createReminder(input: CreateReminderInput): ReminderRecord;
    getReminder(reminderId: string): ReminderRecord | undefined;
    listRemindersForCreator(sessionId: string, creatorUserId: string, limit?: number): ReminderRecord[];
    listTasksForCreator(sessionId: string, creatorUserId: string, limit?: number): ReminderRecord[];
    cancelReminder(reminderId: string, creatorUserId: string, now: number): ReminderRecord | undefined;
    cancelTaskChain(reminderId: string, creatorUserId: string, now: number): number;
    claimDueReminders(now: number, limit: number): ReminderRecord[];
    createDeliveryAttempt(reminderId: string, now: number): ReminderDeliveryRecord;
    getDelivery(attemptId: string): ReminderDeliveryRecord | undefined;
    listDeliveries(reminderId: string): ReminderDeliveryRecord[];
    hasSentDelivery(reminderId: string): boolean;
    markDeliverySent(attemptId: string, now: number, providerMessageId?: string): void;
    markDeliveryFailed(attemptId: string, now: number, error: string): void;
    markReminderSent(reminderId: string, now: number): void;
    cloneNextOccurrence(reminderId: string, now: number): ReminderRecord | undefined;
    updateExecution(reminderId: string, now: number, status: 'success' | 'failed', resultSummary?: string): void;
    markReminderRetry(reminderId: string, now: number, nextAttemptAt: number, error: string): void;
    markReminderFailed(reminderId: string, now: number, error: string): void;
    recoverStaleDelivering(now: number, staleAfterMs: number): number;
    dispose(): void;
    private migrateSchema;
}
