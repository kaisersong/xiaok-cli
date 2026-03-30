import Anthropic from '@anthropic-ai/sdk';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';
import type { CachedToolDefinition, ModelInvocationOptions, SystemPromptBlock } from '../runtime/model-capabilities.js';

const MAX_RETRIES = 3;

export class ClaudeAdapter implements ModelAdapter {
  client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = 'claude-opus-4-6', baseUrl?: string) {
    this.client = new Anthropic({ apiKey, baseURL: baseUrl, maxRetries: MAX_RETRIES });
    this.model = model;
  }

  getModelName(): string {
    return this.model;
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    options?: ModelInvocationOptions,
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

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 8192,
      system: (options?.promptCache?.systemPrompt ?? systemPrompt) as string | SystemPromptBlock[],
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    // Buffer for tool_use arguments
    const toolBuffers = new Map<number, { id: string; name: string; jsonBuffer: string }>();

    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
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
      } else if (event.type === 'message_stop') {
        yield { type: 'done' };
      }
    }
  }
}
