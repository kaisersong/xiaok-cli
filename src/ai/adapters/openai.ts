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
      if (m.role === 'assistant') {
        const textBlocks = m.content.filter((block) => block.type === 'text');
        const toolUseBlocks = m.content.filter((block) => block.type === 'tool_use');

        const msg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: textBlocks.length > 0 ? textBlocks.map((block) => block.text).join('') : null,
        };

        if (toolUseBlocks.length > 0) {
          msg.tool_calls = toolUseBlocks.map((block) => ({
            id: block.id,
            type: 'function' as const,
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          }));
        }

        openaiMessages.push(msg);
        continue;
      }

      const textBlocks = m.content.filter((block) => block.type === 'text');
      if (textBlocks.length > 0) {
        openaiMessages.push({
          role: 'user',
          content: textBlocks.map((block) => block.text).join(''),
        });
      }

      const toolResults = m.content.filter((block) => block.type === 'tool_result');
      for (const item of toolResults) {
        openaiMessages.push({
          role: 'tool' as const,
          tool_call_id: item.tool_use_id,
          content: item.content,
        });
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

    const toolBuffers = new Map<number, { id: string; name: string; argsBuffer: string }>();
    let emittedDone = false;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: 'text', delta: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const current = toolBuffers.get(tc.index) ?? { id: '', name: '', argsBuffer: '' };
          if (tc.id) current.id = tc.id;
          if (tc.function?.name) current.name = tc.function.name;
          if (tc.function?.arguments) current.argsBuffer += tc.function.arguments;
          toolBuffers.set(tc.index, current);
        }
      }

      if (choice?.finish_reason) {
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
        emittedDone = true;
        yield { type: 'done' };
        return;
      }
    }

    if (!emittedDone) {
      for (const buf of toolBuffers.values()) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(buf.argsBuffer || '{}') as Record<string, unknown>;
        } catch {
          input = { _raw: buf.argsBuffer };
        }
        yield { type: 'tool_use', id: buf.id, name: buf.name, input };
      }
      yield { type: 'done' };
    }
  }
}
