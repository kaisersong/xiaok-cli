import type { Tool } from '../../types.js';
import { type ReminderApi } from '../../runtime/reminder/service.js';
export interface ReminderToolOptions {
    reminders: ReminderApi;
    sessionId: string;
    creatorUserId: string;
    timezone: string;
}
export declare function createReminderTools(options: ReminderToolOptions): Tool[];
