import type { MessageBlock, ModelAdapter } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { PromptSnapshot } from '../prompts/types.js';
import { AgentRunController } from './controller.js';
import type { AgentRuntimeEvent } from './events.js';
import { AgentSessionState } from './session.js';
import type { FileMemoryStore } from '../memory/store.js';
export interface AgentRuntimeOptions {
    adapter: ModelAdapter;
    registry: ToolRegistry;
    session: AgentSessionState;
    controller: AgentRunController;
    systemPrompt: string;
    promptSnapshot?: PromptSnapshot;
    maxIterations?: number;
    contextLimit?: number;
    compactThreshold?: number;
    compactPlaceholder?: string;
    memoryStore?: FileMemoryStore;
}
export declare class AgentRuntime {
    private adapter;
    private readonly registry;
    private readonly session;
    private readonly controller;
    private systemPrompt;
    private readonly maxIterations?;
    private readonly contextLimitOverride?;
    private readonly compactThresholdOverride?;
    private contextLimit;
    private compactThreshold;
    private readonly compactPlaceholder;
    private supportsPromptCaching;
    private promptSnapshot?;
    private compactRunner;
    private readonly memoryStore?;
    private static readonly MAX_EMPTY_RETRIES;
    constructor(options: AgentRuntimeOptions);
    setAdapter(adapter: ModelAdapter): void;
    setSystemPrompt(systemPrompt: string): void;
    setPromptSnapshot(promptSnapshot: PromptSnapshot | undefined): void;
    run(input: string | MessageBlock[], onEvent: (event: AgentRuntimeEvent) => void, externalSignal?: AbortSignal): Promise<void>;
    private throwIfAborted;
    private isAbortError;
    private refreshModelPolicy;
    private buildInvocationOptions;
    private buildToolExecutionContext;
    private injectMemoryAfterCompact;
}
