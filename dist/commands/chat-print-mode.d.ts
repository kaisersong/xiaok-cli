import type { UsageStats } from '../types.js';
export interface PrintResult {
    sessionId: string;
    text: string;
    usage: UsageStats;
    /** Number of turns in the conversation */
    num_turns?: number;
    /** Number of AskUserQuestion tool calls */
    ask_user_calls?: number;
    /** List of tools called */
    tool_calls?: string[];
    /** Duration in milliseconds */
    duration_ms?: number;
}
export declare function formatPrintOutput(result: PrintResult, asJson: boolean): string;
