import type { UsageStats } from '../types.js';
export interface PrintResult {
    sessionId: string;
    text: string;
    usage: UsageStats;
}
export declare function formatPrintOutput(result: PrintResult, asJson: boolean): string;
