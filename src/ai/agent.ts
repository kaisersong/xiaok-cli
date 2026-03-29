import type { ModelAdapter, Message, StreamChunk, ToolResultContent } from '../types.js';
import type { ToolRegistry } from './tools/index.js';

export type OnChunk = (chunk: StreamChunk) => void;

export class Agent {
  private messages: Message[] = [];
  private adapter: ModelAdapter;
  private registry: ToolRegistry;
  private systemPrompt: string;

  constructor(adapter: ModelAdapter, registry: ToolRegistry, systemPrompt: string) {
    this.adapter = adapter;
    this.registry = registry;
    this.systemPrompt = systemPrompt;
  }

  /** 执行一轮对话（可能包含多次工具调用循环） */
  async runTurn(userInput: string, onChunk: OnChunk): Promise<void> {
    this.messages.push({ role: 'user', content: userInput });

    while (true) {
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      const textParts: string[] = [];

      for await (const chunk of this.adapter.stream(
        this.messages,
        this.registry.getToolDefinitions(),
        this.systemPrompt
      )) {
        if (chunk.type === 'text') {
          textParts.push(chunk.delta);
          onChunk(chunk);
        } else if (chunk.type === 'tool_use') {
          toolCalls.push({ id: chunk.id, name: chunk.name, input: chunk.input });
        } else if (chunk.type === 'done') {
          break;
        }
      }

      // 构建 assistant message，保留 toolCalls 供 OpenAI 适配器使用
      const assistantContent = textParts.join('');
      this.messages.push({
        role: 'assistant',
        content: assistantContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      // 如果没有工具调用，对话结束
      if (toolCalls.length === 0) break;

      // 执行工具调用，收集结果
      const toolResults: ToolResultContent[] = [];
      for (const tc of toolCalls) {
        const result = await this.registry.executeTool(tc.name, tc.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: result,
          is_error: result.startsWith('Error'),
        });
      }

      this.messages.push({ role: 'tool_result', content: toolResults });
    }
  }

  /** 清空历史记录（会话结束时调用） */
  clearHistory(): void {
    this.messages = [];
  }
}
