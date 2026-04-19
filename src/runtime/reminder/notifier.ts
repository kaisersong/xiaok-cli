import { ReminderDeliveryError } from './errors.js';
import type { ReminderNotifier, ReminderNotifierResult, ReminderRecord } from './types.js';

export type ReminderSink = (message: string, reminder: ReminderRecord) => Promise<void> | void;

export class InChatReminderNotifier implements ReminderNotifier {
  private readonly sinks = new Map<string, ReminderSink>();

  register(sessionId: string, sink: ReminderSink): () => void {
    this.sinks.set(sessionId, sink);
    return () => {
      if (this.sinks.get(sessionId) === sink) {
        this.sinks.delete(sessionId);
      }
    };
  }

  async deliver(reminder: ReminderRecord): Promise<ReminderNotifierResult> {
    const targetSessionId = typeof reminder.deliveryTarget.targetSessionId === 'string'
      ? reminder.deliveryTarget.targetSessionId
      : reminder.sessionId;
    const sink = this.sinks.get(targetSessionId);
    if (!sink) {
      throw new ReminderDeliveryError('target session offline', {
        retryable: false,
        code: 'target_session_offline',
      });
    }

    await sink(`提醒：${reminder.content}`, reminder);
    return {};
  }
}
