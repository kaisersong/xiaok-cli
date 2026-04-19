import OpenAI from 'openai';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';
import type { ModelInvocationOptions } from '../runtime/model-capabilities.js';
import { estimateTokens } from '../runtime/usage.js';

const MAX_RETRIES = 3;
const KIMI_CODING_COMPAT_USER_AGENT = 'claude-code/1.0';

function isKimiCodingEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false;

  try {
    const url = new URL(baseUrl);
    return url.hostname === 'api.kimi.com' && url.pathname.startsWith('/coding');
  } catch {
    return false;
  }
}

function collectReasoningText(blocks: Message['content']): string | undefined {
  const reasoning = blocks
    .filter((block): block is Extract<Message['content'][number], { type: 'thinking' }> => block.type === 'thinking')
    .map((block) => block.thinking.trim())
    .filter(Boolean)
    .join('\n\n');

  return reasoning || undefined;
}

function extractReasoningDeltas(delta: Record<string, unknown>): Array<{ signature: string; text: string }> {
  const chunks: Array<{ signature: string; text: string }> = [];
  const reasoningDetails = delta.reasoning_details;
  let usedReasoningDetails = false;

  if (Array.isArray(reasoningDetails)) {
    for (const item of reasoningDetails) {
      const detail = item as { type?: unknown; text?: unknown };
      if (detail.type === 'reasoning.text' && typeof detail.text === 'string' && detail.text.length > 0) {
        chunks.push({ signature: 'reasoning_details', text: detail.text });
        usedReasoningDetails = true;
      }
    }
  }

  if (!usedReasoningDetails) {
    for (const field of ['reasoning_content', 'reasoning', 'reasoning_text'] as const) {
      const value = delta[field];
      if (typeof value === 'string' && value.length > 0) {
        chunks.push({ signature: field, text: value });
        break;
      }
    }
  }

  return chunks;
}

export class OpenAIAdapter implements ModelAdapter {
  client: OpenAI;
  private readonly apiKey: string;
  private readonly baseUrl?: string;
  private readonly defaultHeaders?: Record<string, string>;
  private model: string;

  constructor(apiKey: string, model = 'gpt-4o', baseUrl?: string, defaultHeaders?: Record<string, string>) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.defaultHeaders = defaultHeaders;
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
      maxRetries: MAX_RETRIES,
      defaultHeaders: {
        ...(defaultHeaders ?? {}),
        ...(isKimiCodingEndpoint(baseUrl)
          ? { 'User-Agent': KIMI_CODING_COMPAT_USER_AGENT }
          : {}),
      },
    });
    this.model = model;
  }

  getModelName(): string {
    return this.model;
  }

  cloneWithModel(model: string): OpenAIAdapter {
    return new OpenAIAdapter(this.apiKey, model, this.baseUrl, this.defaultHeaders);
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    _options?: ModelInvocationOptions,
  ): AsyncIterable<StreamChunk> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const m of messages) {
      if (m.role === 'assistant') {
        const textBlocks = m.content.filter((block) => block.type === 'text');
        const toolUseBlocks = m.content.filter((block) => block.type === 'tool_use');
        const reasoningContent = collectReasoningText(m.content);

        const msg: OpenAI.ChatCompletionAssistantMessageParam & { reasoning_content?: string } = {
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

        if (reasoningContent) {
          msg.reasoning_content = reasoningContent;
        }

        openaiMessages.push(msg);
        continue;
      }

      const textBlocks = m.content.filter((block) => block.type === 'text');
      const imageBlocks = m.content.filter((block) => block.type === 'image');
      if (imageBlocks.length > 0) {
        const contentParts = [
          ...textBlocks.map((block) => ({
            type: 'text' as const,
            text: block.text,
          })),
          ...imageBlocks.map((block) => ({
            type: 'image_url' as const,
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          })),
        ];

        openaiMessages.push({
          role: 'user',
          content: contentParts,
        } as OpenAI.ChatCompletionUserMessageParam);
      } else if (textBlocks.length > 0) {
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
      stream_options: { include_usage: true },
    });

    const toolBuffers = new Map<number, { id: string; name: string; argsBuffer: string }>();
    let emittedDone = false;
    let outputChars = 0;
    let usageReceived = false;

    for await (const chunk of stream) {
      // Extract usage from chunk (include_usage: true)
      if (chunk.usage) {
        usageReceived = true;
        yield {
          type: 'usage',
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          },
        };
      }

      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (!delta) continue;

      for (const reasoning of extractReasoningDeltas(delta as Record<string, unknown>)) {
        yield { type: 'thinking', delta: reasoning.text, signature: reasoning.signature };
      }

      if (delta.content) {
        outputChars += delta.content.length;
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
            input = JSON.parse(buf.argsBuffer || '{}');
          } catch {
            input = { _raw: buf.argsBuffer };
          }
          yield { type: 'tool_use', id: buf.id, name: buf.name, input };
        }
        toolBuffers.clear();

        // If the API didn't return usage, estimate locally
        if (!usageReceived) {
          const allInputMessages = [
            { role: 'user' as const, content: [{ type: 'text' as const, text: systemPrompt }] },
            ...messages.map(m => ({
              role: m.role,
              content: m.content.map(b => {
                if (b.type === 'text') return { type: 'text' as const, text: b.text };
                if (b.type === 'tool_use') return { type: 'text' as const, text: JSON.stringify(b.input) };
                if (b.type === 'tool_result') return { type: 'text' as const, text: b.content };
                if (b.type === 'image') return { type: 'text' as const, text: '[image]' };
                return { type: 'text' as const, text: '' };
              }),
            })),
          ];
          const inputTokens = estimateTokens(allInputMessages as unknown as Message[]);
          yield {
            type: 'usage',
            usage: {
              inputTokens,
              outputTokens: Math.ceil(outputChars / 4),
            },
          };
        }

        emittedDone = true;
        yield { type: 'done' };
        return;
      }
    }

    if (!emittedDone) {
      for (const buf of toolBuffers.values()) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(buf.argsBuffer || '{}');
        } catch {
          input = { _raw: buf.argsBuffer };
        }
        yield { type: 'tool_use', id: buf.id, name: buf.name, input };
      }

      if (!usageReceived) {
        const allInputMessages = [
          { role: 'user' as const, content: [{ type: 'text' as const, text: systemPrompt }] },
          ...messages.map(m => ({
            role: m.role,
            content: m.content.map(b => {
              if (b.type === 'text') return { type: 'text' as const, text: b.text };
              if (b.type === 'tool_use') return { type: 'text' as const, text: JSON.stringify(b.input) };
              if (b.type === 'tool_result') return { type: 'text' as const, text: b.content };
              if (b.type === 'image') return { type: 'text' as const, text: '[image]' };
              return { type: 'text' as const, text: '' };
            }),
          })),
        ];
        const inputTokens = estimateTokens(allInputMessages as unknown as Message[]);
        yield {
          type: 'usage',
          usage: {
            inputTokens,
            outputTokens: Math.ceil(outputChars / 4),
          },
        };
      }

      yield { type: 'done' };
    }
  }
}
