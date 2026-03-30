import type { MessageBlock, ModelAdapter, ToolCall } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import { AgentRunController } from './controller.js';
import type { AgentRuntimeEvent } from './events.js';
import { AgentSessionState } from './session.js';
import { estimateTokens, shouldCompact } from './usage.js';

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

export class AgentRuntime {
  private adapter: ModelAdapter;
  private readonly registry: ToolRegistry;
  private readonly session: AgentSessionState;
  private readonly controller: AgentRunController;
  private systemPrompt: string;
  private readonly maxIterations: number;
  private readonly contextLimit: number;
  private readonly compactThreshold: number;
  private readonly compactPlaceholder: string;

  constructor(options: AgentRuntimeOptions) {
    this.adapter = options.adapter;
    this.registry = options.registry;
    this.session = options.session;
    this.controller = options.controller;
    this.systemPrompt = options.systemPrompt;
    this.maxIterations = options.maxIterations ?? 12;
    this.contextLimit = options.contextLimit ?? 200_000;
    this.compactThreshold = options.compactThreshold ?? 0.85;
    this.compactPlaceholder = options.compactPlaceholder ?? '[context compacted]';
  }

  setAdapter(adapter: ModelAdapter): void {
    this.adapter = adapter;
  }

  setSystemPrompt(systemPrompt: string): void {
    this.systemPrompt = systemPrompt;
  }

  async run(
    input: string,
    onEvent: (event: AgentRuntimeEvent) => void,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    this.throwIfAborted(externalSignal);

    const run = this.controller.startRun();
    onEvent({ type: 'run_started', runId: run.runId });
    this.session.appendUserText(input);

    try {
      for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
        this.throwIfAborted(run.signal, externalSignal, onEvent, run.runId);

        if (shouldCompact(estimateTokens(this.session.getMessages()), this.contextLimit, this.compactThreshold)) {
          this.session.forceCompact(this.compactPlaceholder);
          onEvent({ type: 'compact_triggered', runId: run.runId });
        }

        const assistantBlocks: MessageBlock[] = [];
        for await (const chunk of this.adapter.stream(
          this.session.getMessages(),
          this.registry.getToolDefinitions(),
          this.systemPrompt,
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

        const toolCalls = assistantBlocks.filter((block): block is ToolCall => block.type === 'tool_use');
        if (toolCalls.length === 0) {
          onEvent({ type: 'run_completed', runId: run.runId });
          return;
        }

        const toolResults: MessageBlock[] = [];
        for (const toolCall of toolCalls) {
          this.throwIfAborted(run.signal, externalSignal, onEvent, run.runId);
          onEvent({
            type: 'tool_started',
            runId: run.runId,
            toolName: toolCall.name,
            input: toolCall.input,
          });

          const result = await this.registry.executeTool(toolCall.name, toolCall.input);
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
            content: result,
            is_error: !ok,
          });
        }

        this.session.appendUserToolResults(toolResults);
      }

      throw new Error('agent runtime reached max iterations');
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
}
