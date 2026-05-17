import { getReminderErrorMessage, isRetryableReminderError } from './errors.js';
import { REMINDER_RETRY_DELAYS_MS } from './types.js';
export class ReminderScheduler {
    options;
    now;
    scanIntervalMs;
    batchSize;
    staleAfterMs;
    retryDelaysMs;
    timer = null;
    constructor(options) {
        this.options = options;
        this.now = options.now ?? (() => Date.now());
        this.scanIntervalMs = options.scanIntervalMs ?? 5_000;
        this.batchSize = options.batchSize ?? 20;
        this.staleAfterMs = options.staleAfterMs ?? 10 * 60_000;
        this.retryDelaysMs = options.retryDelaysMs ?? REMINDER_RETRY_DELAYS_MS;
    }
    async start() {
        if (this.timer) {
            return;
        }
        this.options.store.recoverStaleDelivering(this.now(), this.staleAfterMs);
        this.timer = setInterval(() => {
            void this.runOnce().catch(() => undefined);
        }, this.scanIntervalMs);
    }
    stop() {
        if (!this.timer) {
            return;
        }
        clearInterval(this.timer);
        this.timer = null;
    }
    async runOnce() {
        const now = this.now();
        this.options.store.recoverStaleDelivering(now, this.staleAfterMs);
        const reminders = this.options.store.claimDueReminders(now, this.batchSize);
        for (const reminder of reminders) {
            if (this.options.store.hasSentDelivery(reminder.reminderId)) {
                this.options.store.markReminderSent(reminder.reminderId, now);
                continue;
            }
            const attempt = this.options.store.createDeliveryAttempt(reminder.reminderId, now);
            try {
                const result = await this.options.notifier.deliver(reminder);
                this.options.store.markDeliverySent(attempt.attemptId, this.now(), result.providerMessageId);
                this.options.store.markReminderSent(reminder.reminderId, this.now());
                if (reminder.recurrence) {
                    this.options.store.cloneNextOccurrence(reminder.reminderId, this.now());
                }
            }
            catch (error) {
                const message = getReminderErrorMessage(error);
                const retryable = isRetryableReminderError(error);
                const failureTime = this.now();
                this.options.store.markDeliveryFailed(attempt.attemptId, failureTime, message);
                if (retryable && reminder.retryCount + 1 < reminder.maxRetry) {
                    const delay = this.retryDelaysMs[Math.min(reminder.retryCount, this.retryDelaysMs.length - 1)];
                    this.options.store.markReminderRetry(reminder.reminderId, failureTime, failureTime + delay, message);
                }
                else {
                    this.options.store.markReminderFailed(reminder.reminderId, failureTime, message);
                }
            }
        }
    }
}
