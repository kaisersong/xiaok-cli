import OpenAI from 'openai';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';

const MAX_RETRIES = 3;

export class OpenAIAdapter implements ModelAdapter {
  client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = 'gpt-4o', baseUrl?: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl, maxRetries: MAX_RETRIES });
    this.model = model;
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): AsyncIterable<StreamChunk> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const m of messages) {
      if (m.role === 'tool_result') {
        // 每条 ToolResultContent 展开为独立的 tool 消息
        const items = Array.isArray(m.content) ? m.content : [];
        for (const item of items) {
          openaiMessages.push({
            role: 'tool' as const,
            tool_call_id: item.tool_use_id,
            content: item.content,
          });
        }
      } else if (m.role === 'assistant') {
        const msg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: (m.content as string) || null,
        };
        // 如果 assistant 消息携带 tool_calls，必须传给 OpenAI
        if (m.toolCalls && m.toolCalls.length > 0) {
          msg.tool_calls = m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          }));
        }
        openaiMessages.push(msg);
      } else {
        openaiMessages.push({ role: 'user', content: m.content as string });
      }
    }

    const openaiTools: OpenAI.ChatCompletionTool[] = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }));

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      stream: true,
    });

    // Buffer for tool_calls arguments
    const toolBuffers = new Map<number, { id: string; name: string; argsBuffer: string }>();
    let gotFinishReason = false;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: 'text', delta: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolBuffers.has(tc.index)) {
            toolBuffers.set(tc.index, { id: tc.id ?? '', name: tc.function?.name ?? '', argsBuffer: '' });
          }
          const buf = toolBuffers.get(tc.index)!;
          if (tc.function?.arguments) buf.argsBuffer += tc.function.arguments;
          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name = tc.function.name;
        }
      }

      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason) {
        gotFinishReason = true;
        for (const buf of toolBuffers.values()) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(buf.argsBuffer || '{}') as Record<string, unknown>;
          } catch {
            input = { _raw: buf.argsBuffer };
          }
          yield { type: 'tool_use', id: buf.id, name: buf.name, input };
        }
        toolBuffers.clear();
        yield { type: 'done' };
      }
    }

    // 防御：部分 provider 不发 finish_reason，确保 done 总会发出
    if (!gotFinishReason) {
      for (const buf of toolBuffers.values()) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(buf.argsBuffer || '{}') as Record<string, unknown>; } catch { /**/ }
        yield { type: 'tool_use', id: buf.id, name: buf.name, input };
      }
      yield { type: 'done' };
    }
  }
}
