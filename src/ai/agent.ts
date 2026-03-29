import type {
  Message,
  MessageBlock,
  ModelAdapter,
  RuntimeHookSink,
  StreamChunk,
  ToolCall,
  UsageStats,
} from '../types.js';
import type { ToolRegistry } from './tools/index.js';
import type { RuntimeEvent } from '../runtime/events.js';
import { compactMessages, estimateTokens, mergeUsage, shouldCompact } from './runtime/usage.js';

export type OnChunk = (chunk: StreamChunk) => void;

let nextSessionOrdinal = 0;

export interface AgentOptions {
  maxIterations?: number;
  contextLimit?: number;
  compactThreshold?: number;
  compactPlaceholder?: string;
  hooks?: RuntimeHookSink;
}

export class Agent {
  private messages: Message[] = [];
  private usage: UsageStats = { inputTokens: 0, outputTokens: 0 };
  private readonly sessionId = `sess_${(nextSessionOrdinal += 1)}`;
  private turnCount = 0;

  constructor(
    private adapter: ModelAdapter,
    private registry: ToolRegistry,
    private systemPrompt: string,
    private options: AgentOptions = {}
  ) {}

  /** 执行一轮对话（可能包含多次工具调用循环） */
  async runTurn(userInput: string, onChunk: OnChunk, signal?: AbortSignal): Promise<void> {
    this.throwIfAborted(signal);
    const turnId = `turn_${(this.turnCount += 1)}`;
    this.emit({
      type: 'turn_started',
      sessionId: this.sessionId,
      turnId,
    });
    this.messages.push({
      role: 'user',
      content: [{ type: 'text', text: userInput }],
    });

    const maxIterations = this.options.maxIterations ?? 12;
    const contextLimit = this.options.contextLimit ?? 200_000;
    const compactThreshold = this.options.compactThreshold ?? 0.85;
    const compactPlaceholder = this.options.compactPlaceholder ?? '[context compacted]';

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      this.throwIfAborted(signal);

      if (shouldCompact(estimateTokens(this.messages), contextLimit, compactThreshold)) {
        this.messages = compactMessages(this.messages, compactPlaceholder);
      }

      const assistantBlocks: MessageBlock[] = [];

      for await (const chunk of this.adapter.stream(
        this.messages,
        this.registry.getToolDefinitions(),
        this.systemPrompt
      )) {
        this.throwIfAborted(signal);

        if (chunk.type === 'text') {
          assistantBlocks.push({ type: 'text', text: chunk.delta });
          onChunk(chunk);
          continue;
        }

        if (chunk.type === 'tool_use') {
          assistantBlocks.push(chunk);
          continue;
        }

        if (chunk.type === 'usage') {
          this.usage = mergeUsage(this.usage, chunk.usage);
          onChunk(chunk);
          continue;
        }

        if (chunk.type === 'done') {
          break;
        }
      }

      if (assistantBlocks.length > 0) {
        this.messages.push({
          role: 'assistant',
          content: assistantBlocks,
        });
      }

      const toolCalls = assistantBlocks.filter((block): block is ToolCall => block.type === 'tool_use');

      if (toolCalls.length === 0) {
        this.emit({
          type: 'turn_completed',
          sessionId: this.sessionId,
          turnId,
        });
        return;
      }

      const toolResults: MessageBlock[] = [];
      for (const tc of toolCalls) {
        this.emit({
          type: 'tool_started',
          sessionId: this.sessionId,
          turnId,
          toolName: tc.name,
        });
        const result = await this.registry.executeTool(tc.name, tc.input);
        const isError = result.startsWith('Error');
        this.emit({
          type: 'tool_finished',
          sessionId: this.sessionId,
          turnId,
          toolName: tc.name,
          ok: !isError,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: result,
          is_error: isError,
        });
      }

      this.messages.push({ role: 'user', content: toolResults });
    }

    throw new Error('agent reached max iterations');
  }

  /** 清空历史记录（会话结束时调用） */
  clearHistory(): void {
    this.messages = [];
    this.usage = { inputTokens: 0, outputTokens: 0 };
  }

  getUsage(): UsageStats {
    return this.usage;
  }

  setAdapter(adapter: ModelAdapter): void {
    this.adapter = adapter;
  }

  setSystemPrompt(systemPrompt: string): void {
    this.systemPrompt = systemPrompt;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('agent aborted');
    }
  }

  private emit(event: RuntimeEvent): void {
    this.options.hooks?.emit(event);
  }
}
