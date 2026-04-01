import type { Message } from '../../types.js';
export interface UsageStats {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
}
export interface CompactionSummary {
    text: string;
    replacedMessages: number;
}
export declare function estimateTokens(messages: Message[]): number;
export declare function shouldCompact(estimatedTokens: number, contextLimit: number, threshold?: number): boolean;
export declare function mergeUsage(base: UsageStats, next: UsageStats): UsageStats;
export declare function summarizeMessagesForCompaction(messages: Message[]): CompactionSummary;
export declare function compactMessages(messages: Message[], placeholder?: string, keepRecent?: number): {
    messages: Message[];
    summary: CompactionSummary;
};
