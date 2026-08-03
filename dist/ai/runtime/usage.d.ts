import type { Message, ToolDefinition } from '../../types.js';
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
/**
 * 估算每次请求除 session messages 之外**必然**携带的部分：system prompt 与全部
 * tool 定义（见 agent-runtime 调用 stream 时传入的 `systemPrompt` / `tools`）。
 *
 * 压缩判定原先只估算 messages，于是这部分固定开销一直不占额度，导致压缩偏晚。
 * 口径与 estimateTokens 一致（chars/4），因此两者可直接相加。
 */
export declare function estimateRequestOverheadTokens(systemPrompt: string, tools: ToolDefinition[]): number;
export declare function shouldCompact(estimatedTokens: number, contextLimit: number, threshold?: number): boolean;
export declare function mergeUsage(base: UsageStats, next: UsageStats): UsageStats;
export declare function computeCost(usage: UsageStats, model: string): number;
export declare function computeCostWithConfidence(usage: UsageStats, model: string): {
    cost: number;
    confidence: CostConfidence;
};
export declare function summarizeMessagesForCompaction(messages: Message[]): CompactionSummary;
export type CompactionPlanInvalidReason = 'unpaired_tool_result' | 'duplicate_tool_call_id';
export interface CompactionPlan {
    sourceRevision: number;
    sourceMessageCount: number;
    messagesToSummarize: Message[];
    messagesToRetain: Message[];
    replacedMessages: number;
    invalidReason?: CompactionPlanInvalidReason;
}
export type CompactionPlanApplyResult = {
    status: 'compacted';
    messages: Message[];
    summary: CompactionSummary;
} | {
    status: 'no_gain';
    messages: Message[];
    summary: CompactionSummary;
};
export declare function planCompaction(messages: Message[], sourceRevision?: number, keepRecent?: number): CompactionPlan;
export declare function applyCompactionPlan(plan: CompactionPlan, summaryText?: string): CompactionPlanApplyResult;
export interface CompactMessagesOptions {
    summaryText?: string;
    keepRecent?: number;
}
export declare function compactMessages(messages: Message[], placeholder?: string, keepRecent?: number): {
    messages: Message[];
    summary: CompactionSummary;
};
export declare function compactMessages(messages: Message[], options?: CompactMessagesOptions): {
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
