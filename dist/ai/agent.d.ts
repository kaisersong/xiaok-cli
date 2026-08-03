import type { MessageBlock, ModelAdapter, RuntimeHookSink, StreamChunk, UsageStats } from '../types.js';
import type { ToolRegistry } from './tools/index.js';
import type { AgentRuntimeEvent } from './runtime/events.js';
import { AgentSessionState, type AgentSessionSnapshot, type CompactionRecord } from './runtime/session.js';
import type { PromptSnapshot } from './prompts/types.js';
import type { MemoryStore } from './memory/store.js';
import type { RunInvocationContext } from './runtime/model-capabilities.js';
export type OnChunk = (chunk: StreamChunk) => void;
export type OnRuntimeEvent = (event: AgentRuntimeEvent) => void;
export interface AgentOptions {
    maxIterations?: number;
    contextLimit?: number;
    compactThreshold?: number;
    compactPlaceholder?: string;
    hooks?: RuntimeHookSink;
    memoryStore?: MemoryStore;
    providerSurfaceKind?: 'cli-chat-task' | 'cli-subagent';
}
export declare class Agent {
    private adapter;
    private registry;
    private systemPrompt;
    private options;
    private session;
    private readonly controller;
    private readonly sessionId;
    private turnCount;
    private runtime;
    constructor(adapter: ModelAdapter, registry: ToolRegistry, systemPrompt: string, options?: AgentOptions);
    runTurn(userInput: string | MessageBlock[], onChunk: OnChunk, signal?: AbortSignal, invocationContext?: RunInvocationContext, onRuntimeEvent?: OnRuntimeEvent): Promise<void>;
    clearHistory(): void;
    forceCompact(): CompactionRecord | null;
    getUsage(): UsageStats;
    exportSession(): AgentSessionSnapshot;
    restoreSession(snapshot: AgentSessionSnapshot): void;
    getSessionState(): AgentSessionState;
    setAdapter(adapter: ModelAdapter): void;
    setSystemPrompt(systemPrompt: string): void;
    setPromptSnapshot(promptSnapshot: PromptSnapshot | undefined): void;
    private createRuntime;
    private emitLegacyHook;
}
