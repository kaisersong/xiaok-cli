import type { MessageBlock, ModelAdapter, ToolCall, ToolExecutionContext } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { PromptSnapshot } from '../prompts/types.js';
import { AgentRunController } from './controller.js';
import type { AgentRuntimeEvent } from './events.js';
import {
  buildPromptCacheSegments,
  resolveModelCapabilities,
  type CapabilityAwareAdapter,
  type ModelInvocationOptions,
} from './model-capabilities.js';
import { AgentSessionState } from './session.js';
import { estimateTokens, shouldCompact, truncateToolResult } from './usage.js';

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
}

export class AgentRuntime {
  private adapter: ModelAdapter;
  private readonly registry: ToolRegistry;
  private readonly session: AgentSessionState;
  private readonly controller: AgentRunController;
  private systemPrompt: string;
  private readonly maxIterations?: number;
  private readonly contextLimitOverride?: number;
  private readonly compactThresholdOverride?: number;
  private contextLimit: number;
  private compactThreshold: number;
  private readonly compactPlaceholder: string;
  private supportsPromptCaching: boolean;
  private promptSnapshot?: PromptSnapshot;

  constructor(options: AgentRuntimeOptions) {
    this.adapter = options.adapter;
    this.registry = options.registry;
    this.session = options.session;
    this.controller = options.controller;
    this.systemPrompt = options.systemPrompt;
    this.promptSnapshot = options.promptSnapshot;
    this.maxIterations = options.maxIterations;
    this.contextLimitOverride = options.contextLimit;
    this.compactThresholdOverride = options.compactThreshold;
    this.contextLimit = 200_000;
    this.compactThreshold = 0.85;
    this.compactPlaceholder = options.compactPlaceholder ?? '[context compacted]';
    this.supportsPromptCaching = false;
    this.refreshModelPolicy();
  }

  setAdapter(adapter: ModelAdapter): void {
    this.adapter = adapter;
    this.refreshModelPolicy();
  }

  setSystemPrompt(systemPrompt: string): void {
    this.systemPrompt = systemPrompt;
  }

  setPromptSnapshot(promptSnapshot: PromptSnapshot | undefined): void {
    this.promptSnapshot = promptSnapshot;
  }

  async run(
    input: string | MessageBlock[],
    onEvent: (event: AgentRuntimeEvent) => void,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    this.throwIfAborted(externalSignal);

    const run = this.controller.startRun();
    onEvent({ type: 'run_started', runId: run.runId });
    if (typeof input === 'string') {
      this.session.appendUserText(input);
    } else {
      this.session.appendUserBlocks(input);
    }

    try {
      let iteration = 0;
      while (true) {
        this.throwIfAborted(run.signal, externalSignal, onEvent, run.runId);

        // Check if we've reached the max iterations limit (Claude Code style)
        if (this.maxIterations !== undefined && iteration >= this.maxIterations) {
          onEvent({
            type: 'max_iterations_reached',
            runId: run.runId,
            maxIterations: this.maxIterations,
            currentIteration: iteration,
          });
          onEvent({ type: 'run_completed', runId: run.runId });
          return;
        }

        if (shouldCompact(estimateTokens(this.session.getMessages()), this.contextLimit, this.compactThreshold)) {
          const compaction = this.session.forceCompact(this.compactPlaceholder);
          onEvent({
            type: 'compact_triggered',
            runId: run.runId,
            summary: compaction?.summary ?? this.compactPlaceholder,
            compactionId: compaction?.id,
          });
        }

        const assistantBlocks: MessageBlock[] = [];
        for await (const chunk of (this.adapter as CapabilityAwareAdapter).stream(
          this.session.getMessages(),
          this.registry.getToolDefinitions(),
          this.systemPrompt,
          this.buildInvocationOptions(),
        )) {
          this.throwIfAborted(run.signal, externalSignal, onEvent, run.runId);

          if (chunk.type === 'text') {
            assistantBlocks.push({ type: 'text', text: chunk.delta });
            onEvent({ type: 'assistant_text', runId: run.runId, delta: chunk.delta });
            continue;
          }

          if (chunk.type === 'tool_use') {
            assistantBlocks.push(chunk);
            continue;
          }

          if (chunk.type === 'usage') {
            const usage = this.session.updateUsage(chunk.usage);
            onEvent({ type: 'usage_updated', runId: run.runId, usage });
            continue;
          }

          if (chunk.type === 'done') {
            break;
          }
        }

        this.session.appendAssistantBlocks(assistantBlocks);

        if (assistantBlocks.length === 0) {
          throw new Error('模型未返回任何文本或工具调用');
        }

        const toolCalls = assistantBlocks.filter((block): block is ToolCall => block.type === 'tool_use');
        if (toolCalls.length === 0) {
          onEvent({ type: 'run_completed', runId: run.runId });
          return;
        }

        const toolResults: MessageBlock[] = [];
        const toolExecutionContext = this.buildToolExecutionContext();
        for (const toolCall of toolCalls) {
          this.throwIfAborted(run.signal, externalSignal, onEvent, run.runId);
          onEvent({
            type: 'tool_started',
            runId: run.runId,
            toolName: toolCall.name,
            input: toolCall.input,
          });

          const result = await this.registry.executeTool(toolCall.name, toolCall.input, toolExecutionContext);
          const ok = !result.startsWith('Error');
          onEvent({
            type: 'tool_finished',
            runId: run.runId,
            toolName: toolCall.name,
            ok,
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: truncateToolResult(result),
            is_error: !ok,
          });
        }

        this.session.appendUserToolResults(toolResults);
        iteration += 1;
      }
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      const normalized = error instanceof Error ? error : new Error(String(error));
      onEvent({ type: 'run_failed', runId: run.runId, error: normalized });
      throw normalized;
    } finally {
      this.controller.completeRun(run.runId);
    }
  }

  private throwIfAborted(
    activeSignal?: AbortSignal,
    externalSignal?: AbortSignal,
    onEvent?: (event: AgentRuntimeEvent) => void,
    runId?: string,
  ): void {
    if (!activeSignal?.aborted && !externalSignal?.aborted) {
      return;
    }

    if (onEvent && runId) {
      onEvent({ type: 'run_aborted', runId });
    }

    throw new Error('agent aborted');
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && /aborted/i.test(error.message);
  }

  private refreshModelPolicy(): void {
    const capabilities = resolveModelCapabilities(this.adapter);
    this.contextLimit = this.contextLimitOverride ?? capabilities.contextLimit;
    this.compactThreshold = this.compactThresholdOverride ?? capabilities.compactThreshold;
    this.supportsPromptCaching = capabilities.supportsPromptCaching;
  }

  private buildInvocationOptions(): ModelInvocationOptions | undefined {
    if (!this.supportsPromptCaching) {
      return undefined;
    }

    const toolDefinitions = this.registry.getToolDefinitions()
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      promptCache: buildPromptCacheSegments(
        this.systemPrompt,
        toolDefinitions,
        this.session.getMessages(),
      ),
    };
  }

  private buildToolExecutionContext(): ToolExecutionContext {
    const toolDefinitions = this.registry.getToolDefinitions()
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      session: this.session.exportSnapshot(),
      messages: this.session.getMessages().map((message) => ({
        role: message.role,
        content: message.content.map((block) => ({ ...block })),
      })),
      systemPrompt: this.systemPrompt,
      toolDefinitions,
      promptSnapshot: this.promptSnapshot,
      promptCache: this.supportsPromptCaching
        ? buildPromptCacheSegments(this.systemPrompt, toolDefinitions, this.session.getMessages())
        : undefined,
    };
  }
}
