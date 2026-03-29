import type { ModelAdapter, RuntimeHookSink, StreamChunk, UsageStats } from '../types.js';
import type { ToolRegistry } from './tools/index.js';
export type OnChunk = (chunk: StreamChunk) => void;
export interface AgentOptions {
    maxIterations?: number;
    contextLimit?: number;
    compactThreshold?: number;
    compactPlaceholder?: string;
    hooks?: RuntimeHookSink;
}
export declare class Agent {
    private adapter;
    private registry;
    private systemPrompt;
    private options;
    private messages;
    private usage;
    private readonly sessionId;
    private turnCount;
    constructor(adapter: ModelAdapter, registry: ToolRegistry, systemPrompt: string, options?: AgentOptions);
    /** 执行一轮对话（可能包含多次工具调用循环） */
    runTurn(userInput: string, onChunk: OnChunk, signal?: AbortSignal): Promise<void>;
    /** 清空历史记录（会话结束时调用） */
    clearHistory(): void;
    getUsage(): UsageStats;
    setAdapter(adapter: ModelAdapter): void;
    setSystemPrompt(systemPrompt: string): void;
    private throwIfAborted;
    private emit;
}
