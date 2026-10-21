import type { Message, ModelAdapter } from '../../types.js';
import type { StreamOptions } from './model-capabilities.js';
import {
  buildSynthesizedProviderContext,
  isStrictKimiK3Adapter,
} from './provider-private-projection.js';
import { randomUUID } from 'node:crypto';
import { streamCliCompactionProviderConversation } from './provider-conversation-authorization.js';

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools. Do NOT use any tool_use blocks.
Your task is to summarize the conversation below into a compact form that preserves all important context.
Include: key user requests, decisions made, files modified, tool results that matter, and current state.
Write in past tense. Be concise but complete.`;

export class CompactRunner {
  constructor(private readonly adapter: ModelAdapter) {}

  prepareRequest(messages: Message[]): { messages: Message[]; systemPrompt: string } {
    const summaryRequest: Message = {
      role: 'user',
      content: [{
        type: 'text',
        text: 'Please summarize the conversation above into a compact context summary.',
      }],
    };

    const providerMessages = isStrictKimiK3Adapter(this.adapter)
      ? [{
          role: 'user' as const,
          content: [{
            type: 'text' as const,
            text: buildSynthesizedProviderContext('compaction', messages),
          }],
        }]
      : messages;
    return { messages: [...structuredClone(providerMessages), summaryRequest], systemPrompt: NO_TOOLS_PREAMBLE };
  }

  async run(messages: Message[], streamOptions?: StreamOptions, onProgress?: () => void): Promise<string> {
    const prepared = this.prepareRequest(messages);
    const chunks: string[] = [];
    for await (const chunk of streamCliCompactionProviderConversation({
      adapter: this.adapter,
      messages: prepared.messages,
      tools: [],
      systemPrompt: prepared.systemPrompt,
      options: streamOptions,
      invocationId: `inv_${randomUUID()}`,
    })) {
      onProgress?.();
      if (chunk.type === 'text') chunks.push(chunk.delta);
    }

    return chunks.join('').trim();
  }
}
