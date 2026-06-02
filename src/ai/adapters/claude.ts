import type Anthropic from '@anthropic-ai/sdk';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';
import type { CachedToolDefinition, ModelCapabilities, ModelInvocationOptions, SystemPromptBlock } from '../runtime/model-capabilities.js';

const MAX_RETRIES = 3;
const STREAM_TIMEOUT_MS = 5 * 60_000; // 5 min per stream call
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const record = error as unknown as Record<string, unknown>;
    const status = record.status;
    if (typeof status === 'number' && RETRYABLE_STATUS.has(status)) return true;
    const code = typeof record.code === 'string' ? record.code : '';
    if (/ERR_STREAM_PREMATURE_CLOSE|ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR/i.test(code)) return true;
    if (/overload|502|503|timeout|ECONNRESET|ETIMEDOUT|EPIPE|Bad gateway|Premature close|terminated|socket hang up|network|fetch failed/i.test(error.message)) return true;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClaudeAdapter implements ModelAdapter {
  client?: Anthropic;
  private readonly apiKey: string;
  private readonly baseUrl?: string;
  private readonly capabilityOverrides?: Partial<ModelCapabilities>;
  private model: string;
  private clientPromise: Promise<Anthropic> | null = null;

  constructor(
    apiKey: string,
    model = 'claude-opus-4-6',
    baseUrl?: string,
    capabilityOverrides?: Partial<ModelCapabilities>,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.capabilityOverrides = capabilityOverrides;
    this.model = model;
  }

  getModelName(): string {
    return this.model;
  }

  getCapabilities(): Partial<ModelCapabilities> {
    return this.capabilityOverrides ?? {};
  }

  cloneWithModel(model: string): ClaudeAdapter {
    return new ClaudeAdapter(this.apiKey, model, this.baseUrl, this.capabilityOverrides);
  }

  private async getClient(): Promise<Anthropic> {
    if (this.client) {
      return this.client;
    }

    if (!this.clientPromise) {
      this.clientPromise = import('@anthropic-ai/sdk').then(({ default: AnthropicSdk }) => {
        const client = new AnthropicSdk({
          apiKey: this.apiKey,
          baseURL: this.baseUrl,
          maxRetries: MAX_RETRIES,
        });
        this.client = client;
        return client;
      });
    }

    return this.clientPromise;
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    options?: ModelInvocationOptions,
  ): AsyncIterable<StreamChunk> {
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
      let emittedAny = false;
      try {
        for await (const chunk of this.streamOnce(messages, tools, systemPrompt, options, controller.signal)) {
          emittedAny = true;
          yield chunk;
        }
        clearTimeout(timer);
        return;
      } catch (error) {
        clearTimeout(timer);
        // 一旦本次尝试已产出 chunk（消费端已实时落地/上屏），重试会重复输出，必须放弃重试
        if (emittedAny || !isRetryableError(error) || attempt >= MAX_RETRIES) {
          throw error;
        }
        const delayMs = Math.min(1000 * 2 ** attempt, 16000);
        await sleep(delayMs);
        attempt += 1;
      }
    }
  }

  private async *streamOnce(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    options?: ModelInvocationOptions,
    signal?: AbortSignal,
  ): AsyncIterable<StreamChunk> {
    const sourceMessages = options?.promptCache?.messages ?? messages;
    const anthropicMessages: Anthropic.MessageParam[] = sourceMessages.map((message) => {
      const content: Anthropic.ContentBlockParam[] = [];

      for (const block of message.content) {
        if (block.type === 'text') {
          content.push({
            type: 'text',
            text: block.text,
            cache_control: block.cache_control,
          });
          continue;
        }

        if (block.type === 'image') {
          content.push({
            type: 'image',
            source: block.source,
            cache_control: block.cache_control,
          });
          continue;
        }

        if (block.type === 'tool_use') {
          content.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
            cache_control: block.cache_control,
          });
          continue;
        }

        if (block.type === 'tool_result') {
          content.push({
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
            cache_control: block.cache_control,
          });
          continue;
        }
      }

      return {
        role: message.role,
        content,
      };
    });

    const sourceTools = options?.promptCache?.tools ?? tools;
    const anthropicTools = sourceTools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      cache_control: (t as CachedToolDefinition).cache_control,
    }));

    const client = await this.getClient();
    const stream = client.messages.stream({
      model: this.model,
      max_tokens: 8192,
      system: (options?.promptCache?.systemPrompt ?? systemPrompt) as string | SystemPromptBlock[],
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    }, { signal });

    // Buffer for tool_use arguments
    const toolBuffers = new Map<number, { id: string; name: string; jsonBuffer: string }>();

    for await (const event of stream) {
      if (event.type === 'message_start') {
        // 输出 usage 信息
        const usage = event.message.usage;
        if (usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: usage.input_tokens ?? 0,
              outputTokens: usage.output_tokens ?? 0,
              cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
              cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
            },
          };
        }
      } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        toolBuffers.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          jsonBuffer: '',
        });
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'text', delta: delta.text };
        } else if (delta.type === 'input_json_delta') {
          const buf = toolBuffers.get(event.index);
          if (buf) buf.jsonBuffer += delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        const buf = toolBuffers.get(event.index);
        if (buf) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(buf.jsonBuffer || '{}') as Record<string, unknown>;
          } catch {
            input = { _raw: buf.jsonBuffer };
          }
          yield { type: 'tool_use', id: buf.id, name: buf.name, input };
          toolBuffers.delete(event.index);
        }
      } else if (event.type === 'message_delta') {
        // 更新 usage 信息
        const usage = event.usage;
        if (usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: 0, // message_delta 只包含 output tokens
              outputTokens: usage.output_tokens ?? 0,
            },
          };
        }
      } else if (event.type === 'message_stop') {
        yield { type: 'done' };
      }
    }
  }
}
