import { ReminderDeliveryError } from './errors.js';
export class InChatReminderNotifier {
    sinks = new Map();
    register(sessionId, sink) {
        this.sinks.set(sessionId, sink);
        return () => {
            if (this.sinks.get(sessionId) === sink) {
                this.sinks.delete(sessionId);
            }
        };
    }
    async deliver(reminder) {
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
