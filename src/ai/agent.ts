import type {
  MessageBlock,
  ModelAdapter,
  RuntimeHookSink,
  StreamChunk,
  UsageStats,
} from '../types.js';
import type { ToolRegistry } from './tools/index.js';
import { AgentRunController } from './runtime/controller.js';
import type { AgentRuntimeEvent } from './runtime/events.js';
import { toLegacyStreamChunk } from './runtime/events.js';
import { AgentRuntime } from './runtime/agent-runtime.js';
import { AgentSessionState, type AgentSessionSnapshot, type CompactionRecord } from './runtime/session.js';
import type { PromptSnapshot } from './prompts/types.js';
import type { MemoryStore } from './memory/store.js';

export type OnChunk = (chunk: StreamChunk) => void;

let nextSessionOrdinal = 0;

export interface AgentOptions {
  maxIterations?: number;
  contextLimit?: number;
  compactThreshold?: number;
  compactPlaceholder?: string;
  hooks?: RuntimeHookSink;
  memoryStore?: MemoryStore;
}

export class Agent {
  private session = new AgentSessionState();
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
    this.runtime = this.createRuntime();
  }

  async runTurn(userInput: string | MessageBlock[], onChunk: OnChunk, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException('agent aborted', 'AbortError');
    }

    const turnId = `turn_${(this.turnCount += 1)}`;

    await this.runtime.run(
      userInput,
      (event) => {
        this.emitLegacyHook(event, turnId);

        const chunk = toLegacyStreamChunk(event);
        if (chunk) {
          onChunk(chunk);
        }
      },
      signal,
    );
  }

  clearHistory(): void {
    this.session = new AgentSessionState();
    this.runtime = this.createRuntime();
  }

  forceCompact(): CompactionRecord | null {
    return this.session.forceCompact('[context compacted]');
  }

  getUsage(): UsageStats {
    return this.session.getUsage();
  }

  exportSession(): AgentSessionSnapshot {
    return this.session.exportSnapshot();
  }

  restoreSession(snapshot: AgentSessionSnapshot): void {
    this.session.restoreSnapshot(snapshot);
  }

  getSessionState(): AgentSessionState {
    return this.session;
  }

  setAdapter(adapter: ModelAdapter): void {
    this.adapter = adapter;
    this.runtime.setAdapter(adapter);
  }

  setSystemPrompt(systemPrompt: string): void {
    this.systemPrompt = systemPrompt;
    this.runtime.setSystemPrompt(systemPrompt);
  }

  setPromptSnapshot(promptSnapshot: PromptSnapshot | undefined): void {
    this.runtime.setPromptSnapshot(promptSnapshot);
  }

  private createRuntime(): AgentRuntime {
    return new AgentRuntime({
      adapter: this.adapter,
      registry: this.registry,
      session: this.session,
      controller: this.controller,
      systemPrompt: this.systemPrompt,
      maxIterations: this.options.maxIterations,
      contextLimit: this.options.contextLimit,
      compactThreshold: this.options.compactThreshold,
      compactPlaceholder: this.options.compactPlaceholder,
      memoryStore: this.options.memoryStore,
    });
  }

  private emitLegacyHook(event: AgentRuntimeEvent, turnId: string): void {
    if (!this.options.hooks) {
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
        toolName: event.toolName,
        ok: event.ok,
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
