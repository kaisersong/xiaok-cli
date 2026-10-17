import type { MessageBlock, ModelAdapter, RuntimeHookSink, StreamChunk, UsageStats } from '../types.js';
import type { ToolRegistry } from './tools/index.js';
import type { AgentRuntimeEvent, RuntimeActivity } from './runtime/events.js';
import type { CompactionCandidateDecision } from '../runtime/sol-pi/compaction-policy.js';
import { AgentSessionState, type AgentSessionSnapshot, type CompactionRecord } from './runtime/session.js';
import type { PromptSnapshot } from './prompts/types.js';
import type { MemoryStore } from './memory/store.js';
import type { RunInvocationContext } from './runtime/model-capabilities.js';
import type { ObservationSessionOwner } from '../runtime/sol-pi/observation-session-owner.js';
export type OnChunk = (chunk: StreamChunk) => void;
export type OnRuntimeEvent = (event: AgentRuntimeEvent) => void;
export interface AgentOptions {
    semanticCompactionOwner?: import('../runtime/sol-pi/semantic-compaction-owner.js').SemanticCompactionOwner;
    onSemanticCompactionOutcome?: (outcome: import('../runtime/sol-pi/semantic-compaction-owner.js').SemanticCompactionOutcome) => void;
    /** Host-owned live identity; observation ownership cannot be attached to a copy. */
    initialSession?: AgentSessionState;
    observationOwner?: ObservationSessionOwner;
    onSemanticCompactionDecision?: (decision: CompactionCandidateDecision) => void;
    onActivity?: (activity: RuntimeActivity) => void;
    takePendingInput?: () => string | undefined;
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
    private readonly observationOwner?;
    private disposed;
    private readonly modelPhysicalOwner;
    private disposalScheduled;
    private disposalWork;
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
    notifySubtaskBoundary(): void;
    setPromptSnapshot(promptSnapshot: PromptSnapshot | undefined): void;
    /** Host stop closes ingress without revoking an owner still used by writers. */
    stopNewRuns(reason?: unknown): void;
    waitForStoppedResources(): Promise<void>;
    waitForIdleResources(): Promise<void>;
    dispose(): void;
    waitForDisposedResources(): Promise<void>;
    private assertLive;
    private assertHistoryMutationAllowed;
    private createRuntime;
    private emitLegacyHook;
}
