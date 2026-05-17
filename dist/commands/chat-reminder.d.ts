import { type ReminderApi } from '../runtime/reminder/service.js';
export interface ChatReminderCommandContext {
    reminders: ReminderApi;
    sessionId: string;
    creatorUserId: string;
}
export declare const CHAT_REMINDER_SLASH_COMMANDS: readonly [{
    readonly cmd: "/reminder";
    readonly desc: "Manage reminders: create, list, or cancel";
    readonly helpLine: "  /reminder <自然语言> | list | cancel <id> - 管理提醒";
}];
export declare function buildChatReminderHelpLines(): string[];
export declare function executeReminderSlashCommand(trimmed: string, context: ChatReminderCommandContext): Promise<string | null>;
