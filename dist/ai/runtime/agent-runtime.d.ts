import { ModelStreamPhysicalOwner } from './model-stream-physical-owner.js';
import { type SemanticCompactionOwner, type SemanticCompactionOutcome } from '../../runtime/sol-pi/semantic-compaction-owner.js';
import type { ObservationSessionOwner } from '../../runtime/sol-pi/observation-session-owner.js';
import type { MessageBlock, ModelAdapter } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { PromptSnapshot } from '../prompts/types.js';
import { AgentRunController } from './controller.js';
import type { AgentRuntimeEvent, RuntimeActivity } from './events.js';
import { type RunInvocationContext } from './model-capabilities.js';
import { AgentSessionState } from './session.js';
import { type CompactionCandidateDecision } from '../../runtime/sol-pi/compaction-policy.js';
import type { MemoryStore } from '../memory/store.js';
import type { ArtifactWorkspaceExecutionScope } from '../../runtime/task-host/types.js';
import { type ProviderConversationSurfaceKind } from './provider-conversation-authorization.js';
export interface AgentRuntimeOptions {
    /** Fixed host lifetime shared across actual Agent runtime replacements. */
    modelPhysicalOwner?: ModelStreamPhysicalOwner;
    semanticCompactionOwner?: SemanticCompactionOwner;
    onSemanticCompactionOutcome?: (outcome: SemanticCompactionOutcome) => void;
    /** Host-only; never constructed from agent input or restored authorization. */
    observationOwner?: ObservationSessionOwner;
    /** Host diagnostics only; cannot enable the semantic executor. */
    onSemanticCompactionDecision?: (decision: CompactionCandidateDecision) => void;
    onActivity?: (activity: RuntimeActivity) => void;
    takePendingInput?: () => string | undefined;
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
    memoryStore?: MemoryStore;
    taskId?: string;
    executionScope?: ArtifactWorkspaceExecutionScope;
    providerSurfaceKind?: Extract<ProviderConversationSurfaceKind, 'cli-chat-task' | 'cli-subagent'>;
}
export declare class AgentRuntime {
    private readonly modelPhysicalOwner;
    private readonly semanticCompactionOwner?;
    private readonly onSemanticCompactionOutcome?;
    private readonly observationOwner?;
    private pendingSubtaskBoundary;
    private readonly onSemanticCompactionDecision?;
    /** Host-confirmed completion candidate; never exposed as an agent tool. */
    notifySubtaskBoundary(): void;
    private readonly onActivity?;
    private readonly takePendingInput?;
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
    private supportsPromptCaching;
    private promptSnapshot?;
    private compactRunner;
    private readonly memoryStore?;
    private readonly taskId?;
    private readonly executionScope?;
    private readonly providerSurfaceKind;
    private static readonly MAX_EMPTY_RETRIES;
    constructor(options: AgentRuntimeOptions);
    setAdapter(adapter: ModelAdapter): void;
    setSystemPrompt(systemPrompt: string): void;
    setPromptSnapshot(promptSnapshot: PromptSnapshot | undefined): void;
    run(input: string | MessageBlock[], onEvent: (event: AgentRuntimeEvent) => void, externalSignal?: AbortSignal, invocationContext?: RunInvocationContext): Promise<void>;
    private runMeasuredBody;
    private reportActivity;
    private refreshModelPolicy;
    private isStrictK3Adapter;
    private buildInvocationOptions;
    private buildToolExecutionContext;
    private emitVerificationGuardIfNeeded;
    private injectMemoryAfterCompact;
}
