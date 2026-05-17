export class ReminderDeliveryError extends Error {
    retryable;
    code;
    constructor(message, options = {}) {
        super(message);
        this.name = 'ReminderDeliveryError';
        this.retryable = options.retryable ?? true;
        this.code = options.code;
    }
}
export function isRetryableReminderError(error) {
    if (error instanceof ReminderDeliveryError) {
        return error.retryable;
    }
    return true;
}
export function getReminderErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
