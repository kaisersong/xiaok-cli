export interface ReminderDeliveryErrorOptions {
  retryable?: boolean;
  code?: string;
}

export class ReminderDeliveryError extends Error {
  readonly retryable: boolean;
  readonly code?: string;

  constructor(message: string, options: ReminderDeliveryErrorOptions = {}) {
    super(message);
    this.name = 'ReminderDeliveryError';
    this.retryable = options.retryable ?? true;
    this.code = options.code;
  }
}

export function isRetryableReminderError(error: unknown): boolean {
  if (error instanceof ReminderDeliveryError) {
    return error.retryable;
  }
  return true;
}

export function getReminderErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
