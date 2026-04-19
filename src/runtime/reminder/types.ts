export type ReminderChannel = 'in_chat';
export type ReminderDeliveryPolicy = 'bound_session';

export type ReminderStatus = 'pending' | 'delivering' | 'retry_wait' | 'sent' | 'failed' | 'cancelled';

export type ReminderDeliveryStatus = 'sending' | 'sent' | 'failed';

export interface ReminderRecord {
  reminderId: string;
  sessionId: string;
  creatorUserId: string;
  content: string;
  scheduleAt: number;
  timezone: string;
  channel: ReminderChannel;
  deliveryPolicy: ReminderDeliveryPolicy;
  deliveryTarget: Record<string, unknown>;
  status: ReminderStatus;
  idempotencyKey: string;
  retryCount: number;
  maxRetry: number;
  nextAttemptAt: number;
  lastAttemptAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  sentAt?: number;
  cancelledAt?: number;
}

export interface ReminderDeliveryRecord {
  attemptId: string;
  reminderId: string;
  channel: ReminderChannel;
  idempotencyKey: string;
  status: ReminderDeliveryStatus;
  providerMessageId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  sentAt?: number;
}

export interface CreateReminderInput {
  sessionId: string;
  creatorUserId: string;
  content: string;
  scheduleAt: number;
  timezone: string;
  channel: ReminderChannel;
  deliveryPolicy?: ReminderDeliveryPolicy;
  deliveryTarget: Record<string, unknown>;
  maxRetry?: number;
}

export type ReminderParseResult =
  | {
    ok: true;
    content: string;
    scheduleAt: number;
    timezone: string;
  }
  | {
    ok: false;
    code: 'needs_confirmation' | 'invalid';
    message: string;
  };

export interface ReminderNotifierResult {
  providerMessageId?: string;
}

export interface ReminderNotifier {
  deliver(reminder: ReminderRecord): Promise<ReminderNotifierResult> | ReminderNotifierResult;
}

export const REMINDER_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000] as const;
