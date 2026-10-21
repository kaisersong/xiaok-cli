import {ModelStreamPhysicalOwner} from './runtime/model-stream-physical-owner.js';
import type {
  MessageBlock,
  ModelAdapter,
  RuntimeHookSink,
  StreamChunk,
  UsageStats,
} from '../types.js';
import type { ToolRegistry } from './tools/index.js';
import { AgentRunController } from './runtime/controller.js';
import type { AgentRuntimeEvent, RuntimeActivity } from './runtime/events.js';
import { toLegacyStreamChunk } from './runtime/events.js';
import type { CompactionCandidateDecision } from '../runtime/sol-pi/compaction-policy.js';
import { AgentRuntime } from './runtime/agent-runtime.js';
import { AgentSessionState, type AgentSessionSnapshot, type CompactionRecord } from './runtime/session.js';
import type { PromptSnapshot } from './prompts/types.js';
import type { MemoryStore } from './memory/store.js';
import type { RunInvocationContext } from './runtime/model-capabilities.js';
import type { ObservationSessionOwner } from '../runtime/sol-pi/observation-session-owner.js';

export type OnChunk = (chunk: StreamChunk) => void;
export type OnRuntimeEvent = (event: AgentRuntimeEvent) => void;

let nextSessionOrdinal = 0;

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

export class Agent {
  private session: AgentSessionState;
  private readonly observationOwner?: ObservationSessionOwner;
  private disposed = false;
  private readonly modelPhysicalOwner=new ModelStreamPhysicalOwner();
  private disposalScheduled=false;
  private disposalWork:Promise<void>|undefined;
  private readonly controller = new AgentRunController();
  private readonly sessionId = `sess_${(nextSessionOrdinal += 1)}`;
  private turnCount = 0;
  private runtime: AgentRuntime;

  constructor(
    private adapter: ModelAdapter,
    private registry: ToolRegistry,
    private systemPrompt: string,
    private options: AgentOptions = {},
  ) {
    this.observationOwner = options.observationOwner;
    if (this.observationOwner && !options.initialSession) throw new Error('SOL_PI_AGENT_INITIAL_SESSION_REQUIRED');
    this.session = options.initialSession ?? new AgentSessionState();
    this.observationOwner?.assertSession(this.session);
    this.runtime = this.createRuntime();
  }

  async runTurn(
    userInput: string | MessageBlock[],
    onChunk: OnChunk,
    signal?: AbortSignal,
    invocationContext?: RunInvocationContext,
    onRuntimeEvent?: OnRuntimeEvent,
  ): Promise<void> {
    signal?.throwIfAborted();
    this.assertLive();

    const turnId = `turn_${(this.turnCount += 1)}`;

    await this.runtime.run(
      userInput,
      (event) => {
        this.emitLegacyHook(event, turnId);
        onRuntimeEvent?.(event);

        const chunk = toLegacyStreamChunk(event);
        if (chunk) {
          onChunk(chunk);
        }
      },
      signal,
      invocationContext,
    );
  }

  clearHistory(): void {
    this.assertHistoryMutationAllowed();
    this.session = new AgentSessionState();
    this.runtime = this.createRuntime();
  }

  forceCompact(): CompactionRecord | null {
    this.assertHistoryMutationAllowed();
    return this.session.forceCompact();
  }

  getUsage(): UsageStats {
    return this.session.getUsage();
  }

  exportSession(): AgentSessionSnapshot {
    return this.session.exportSnapshot();
  }

  restoreSession(snapshot: AgentSessionSnapshot): void {
    this.assertHistoryMutationAllowed();
    this.session.restoreSnapshot(snapshot);
  }

  getSessionState(): AgentSessionState {
    return this.session;
  }

  setAdapter(adapter: ModelAdapter): void {
    this.assertLive();
    if(adapter!==this.adapter&&(this.modelPhysicalOwner.hasPending()||this.modelPhysicalOwner.hasFailure()))throw Error('agent_model_resources_pending');
    if (this.observationOwner) {
      if (adapter !== this.adapter) throw new Error('SOL_PI_AGENT_FRESH_TASK_REQUIRED');
      return;
    }
    this.runtime.setAdapter(adapter);
    this.adapter = adapter;
  }

  setSystemPrompt(systemPrompt: string): void {
    this.assertLive();
    this.systemPrompt = systemPrompt;
    this.runtime.setSystemPrompt(systemPrompt);
  }

  notifySubtaskBoundary(): void {
    this.assertLive();
    this.runtime.notifySubtaskBoundary();
  }

  setPromptSnapshot(promptSnapshot: PromptSnapshot | undefined): void {
    this.assertLive();
    this.runtime.setPromptSnapshot(promptSnapshot);
  }

  /** Host stop closes ingress without revoking an owner still used by writers. */
  stopNewRuns(reason?:unknown):void {
    if(this.disposed)return;this.disposed=true;
    this.modelPhysicalOwner.stop(reason);
    this.controller.abortActiveRun(this.modelPhysicalOwner.signal.reason);
  }
  waitForStoppedResources():Promise<void>{return this.modelPhysicalOwner.waitForStopped();}
  waitForIdleResources():Promise<void>{return this.modelPhysicalOwner.waitForIdle();}
  dispose(): void {
    this.stopNewRuns();if(this.disposalScheduled)return;this.disposalScheduled=true;
    if(!this.modelPhysicalOwner.hasPending()&&!this.modelPhysicalOwner.hasFailure()){
      try{this.observationOwner?.dispose();this.disposalWork=Promise.resolve();}
      catch(error){this.disposalWork=Promise.reject(error);void this.disposalWork.catch(()=>{});throw error;}
      return;
    }
    this.disposalWork=this.waitForStoppedResources().then(()=>this.observationOwner?.dispose());
    // Observe both outcomes while retaining the exact rejected cleanup Promise
    // for a host. Never turn an unknown owner failure into successful release.
    void this.disposalWork.catch(()=>{});
  }
  waitForDisposedResources():Promise<void>{
    return this.disposalScheduled?this.disposalWork!:Promise.reject(Error('agent_disposal_not_started'));
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('agent_disposed');
  }

  private assertHistoryMutationAllowed(): void {
    this.assertLive();
    if(this.modelPhysicalOwner.hasPending()||this.modelPhysicalOwner.hasFailure())throw Error('agent_model_resources_pending');
    if (this.observationOwner) throw new Error('SOL_PI_AGENT_FRESH_TASK_REQUIRED');
  }

  private createRuntime(): AgentRuntime {
    return new AgentRuntime({
      modelPhysicalOwner:this.modelPhysicalOwner,
      adapter: this.adapter,
      registry: this.registry,
      session: this.session,
      observationOwner: this.observationOwner,
      semanticCompactionOwner: this.options.semanticCompactionOwner,
      onSemanticCompactionOutcome: this.options.onSemanticCompactionOutcome,
      controller: this.controller,
      systemPrompt: this.systemPrompt,
      maxIterations: this.options.maxIterations,
      contextLimit: this.options.contextLimit,
      compactThreshold: this.options.compactThreshold,
      compactPlaceholder: this.options.compactPlaceholder,
      memoryStore: this.options.memoryStore,
      providerSurfaceKind: this.options.providerSurfaceKind,
      onActivity: this.options.onActivity,
      takePendingInput: this.options.takePendingInput,
      onSemanticCompactionDecision: this.options.onSemanticCompactionDecision,
    });
  }

  private emitLegacyHook(event: AgentRuntimeEvent, turnId: string): void {
    if (!this.options.hooks) {
      return;
    }

    if (event.type === 'execution_progress') {this.options.hooks.emit({type:'execution_progress',sessionId:this.sessionId,turnId});return;}
    if (event.type === 'execution_health' || event.type === 'model_recovery') {
      this.options.hooks.emit({type:'execution_health',sessionId:this.sessionId,turnId,...(event.type === 'execution_health' ? {invocationId:event.invocationId} : {}),state:event.type === 'model_recovery' ? 'recovering' : event.state});
      return;
    }

    if (event.type === 'run_started') {
      this.options.hooks.emit({
        type: 'turn_started',
        sessionId: this.sessionId,
        turnId,
      });
      return;
    }

    if (event.type === 'run_completed') {
      this.options.hooks.emit({
        type: 'turn_completed',
        sessionId: this.sessionId,
        turnId,
      });
      this.options.hooks.emit({
        type: 'turn_stop',
        sessionId: this.sessionId,
        turnId,
        reason: 'completed',
      });
      return;
    }

    if (event.type === 'run_failed') {
      this.options.hooks.emit({
        type: 'turn_failed',
        sessionId: this.sessionId,
        turnId,
        error: event.error,
      });
      this.options.hooks.emit({
        type: 'turn_stop',
        sessionId: this.sessionId,
        turnId,
        reason: 'error',
      });
      return;
    }

    if (event.type === 'run_aborted') {
      this.options.hooks.emit({
        type: 'turn_aborted',
        sessionId: this.sessionId,
        turnId,
        partialText: event.partialText,
      });
      this.options.hooks.emit({
        type: 'turn_stop',
        sessionId: this.sessionId,
        turnId,
        reason: 'user_aborted',
      });
      return;
    }

    if (event.type === 'tool_started') {
      this.options.hooks.emit({
        type: 'tool_started',
        sessionId: this.sessionId,
        turnId,
        toolName: event.toolName,
        toolInput: event.input,
      });
      return;
    }

    if (event.type === 'tool_finished') {
      this.options.hooks.emit({
        type: 'tool_finished',
        sessionId: this.sessionId,
        turnId,
        invocationId: event.invocationId,
        toolName: event.toolName,
        ok: event.ok,
      });
      return;
    }

    if (event.type === 'tool_execution_fact') {
      this.options.hooks.emit({
        type: 'tool_execution_fact',
        sessionId: this.sessionId,
        turnId,
        invocationId: event.invocationId,
        toolName: event.toolName,
        factKind: event.factKind,
        exitCode: event.exitCode,
        normalizedFilePaths: event.normalizedFilePaths,
      });
      return;
    }

    if (event.type === 'compact_triggered') {
      this.options.hooks.emit({
        type: 'compact_triggered',
        sessionId: this.sessionId,
        turnId,
      });
      return;
    }

    if (event.type === 'compact_failed') {
      this.options.hooks.emit({
        type: 'compact_failed',
        sessionId: this.sessionId,
        turnId,
        error: event.error,
      });
      return;
    }

    if (event.type === 'guard_evaluated') {
      this.options.hooks.emit({
        type: 'guard_evaluated',
        sessionId: this.sessionId,
        turnId,
        guardId: event.guardId,
        mode: event.mode,
        category: event.category,
        reason: event.reason,
        action: event.action,
        taskId: event.taskId,
        artifactId: event.artifactId,
        target: event.target,
      });
    }
  }
}
