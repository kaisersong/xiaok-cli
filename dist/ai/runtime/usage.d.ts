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
export interface ModelPricing {
    model: string;
    inputPer1M: number;
    outputPer1M: number;
    cacheCreationPer1M?: number;
    cacheReadPer1M?: number;
}
export type CostConfidence = 'estimated' | 'unknown';
export declare function estimateTokens(messages: Message[]): number;
export declare function shouldCompact(estimatedTokens: number, contextLimit: number, threshold?: number): boolean;
export declare function mergeUsage(base: UsageStats, next: UsageStats): UsageStats;
export declare function computeCost(usage: UsageStats, model: string): number;
export declare function computeCostWithConfidence(usage: UsageStats, model: string): {
    cost: number;
    confidence: CostConfidence;
};
export declare function summarizeMessagesForCompaction(messages: Message[]): CompactionSummary;
export declare function compactMessages(messages: Message[], placeholder?: string, keepRecent?: number): {
    messages: Message[];
    summary: CompactionSummary;
};
export interface TruncatedResult {
    content: string;
    spillPath?: string;
    hint?: string;
}
export declare function truncateToolResult(content: string, limit?: number, options?: {
    sessionId?: string;
    toolCallId?: string;
    spillDir?: string;
}): TruncatedResult;
