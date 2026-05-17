import type { ReminderParseResult } from './types.js';
export interface ReminderParserOptions {
    now?: () => number;
    timezone: string;
}
export declare function parseReminderRequest(request: string, options: ReminderParserOptions): ReminderParseResult;
