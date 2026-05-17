export interface ReminderDeliveryErrorOptions {
    retryable?: boolean;
    code?: string;
}
export declare class ReminderDeliveryError extends Error {
    readonly retryable: boolean;
    readonly code?: string;
    constructor(message: string, options?: ReminderDeliveryErrorOptions);
}
export declare function isRetryableReminderError(error: unknown): boolean;
export declare function getReminderErrorMessage(error: unknown): string;
