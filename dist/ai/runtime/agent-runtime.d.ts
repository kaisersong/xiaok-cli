import type { MessageBlock, ModelAdapter } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import { AgentRunController } from './controller.js';
import type { AgentRuntimeEvent } from './events.js';
import { AgentSessionState } from './session.js';
export interface AgentRuntimeOptions {
    adapter: ModelAdapter;
    registry: ToolRegistry;
    session: AgentSessionState;
    controller: AgentRunController;
    systemPrompt: string;
    maxIterations?: number;
    contextLimit?: number;
    compactThreshold?: number;
    compactPlaceholder?: string;
}
export declare class AgentRuntime {
    private adapter;
    private readonly registry;
    private readonly session;
    private readonly controller;
    private systemPrompt;
    private readonly maxIterations;
    private readonly contextLimitOverride?;
    private readonly compactThresholdOverride?;
    private contextLimit;
    private compactThreshold;
    private readonly compactPlaceholder;
    private supportsPromptCaching;
    constructor(options: AgentRuntimeOptions);
    setAdapter(adapter: ModelAdapter): void;
    setSystemPrompt(systemPrompt: string): void;
    run(input: string | MessageBlock[], onEvent: (event: AgentRuntimeEvent) => void, externalSignal?: AbortSignal): Promise<void>;
    private throwIfAborted;
    private isAbortError;
    private refreshModelPolicy;
    private buildInvocationOptions;
}
