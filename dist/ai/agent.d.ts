import type { ModelAdapter, StreamChunk } from '../types.js';
import type { ToolRegistry } from './tools/index.js';
export type OnChunk = (chunk: StreamChunk) => void;
export declare class Agent {
    private messages;
    private adapter;
    private registry;
    private systemPrompt;
    constructor(adapter: ModelAdapter, registry: ToolRegistry, systemPrompt: string);
    /** 执行一轮对话（可能包含多次工具调用循环） */
    runTurn(userInput: string, onChunk: OnChunk): Promise<void>;
    /** 清空历史记录（会话结束时调用） */
    clearHistory(): void;
}
