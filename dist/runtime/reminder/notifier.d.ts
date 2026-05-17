import type { ReminderNotifier, ReminderNotifierResult, ReminderRecord } from './types.js';
export type ReminderSink = (message: string, reminder: ReminderRecord) => Promise<void> | void;
export declare class InChatReminderNotifier implements ReminderNotifier {
    private readonly sinks;
    register(sessionId: string, sink: ReminderSink): () => void;
    deliver(reminder: ReminderRecord): Promise<ReminderNotifierResult>;
}
