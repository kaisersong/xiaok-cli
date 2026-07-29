import { createAdapter } from '../../src/ai/models.js';
import type { Message } from '../../src/types.js';
import { loadConfig } from '../../src/utils/config.js';
import type { LoopLLMPort } from './loop-llm-port.js';
import { randomUUID } from 'node:crypto';
import { streamStatelessSideCallProviderConversation } from '../../src/ai/runtime/provider-conversation-authorization.js';

const COMPLETION_TIMEOUT_MS = 30_000;

export function createDesktopLoopLLMPort(): LoopLLMPort {
  return {
    async complete(input) {
      const config = await loadConfig();
      const adapter = createAdapter(config);
      const messages: Message[] = [
        { role: 'user', content: [{ type: 'text', text: input.userMessage }] },
      ];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), COMPLETION_TIMEOUT_MS);
      let text = '';
      try {
        for await (const chunk of streamStatelessSideCallProviderConversation({
          adapter,
          messages,
          tools: [],
          systemPrompt: input.systemPrompt,
          options: { signal: controller.signal },
          invocationId: `inv_${randomUUID()}`,
        })) {
          if (chunk.type === 'text') {
            text += chunk.delta;
            if (text.length >= input.maxTokens * 4) {
              controller.abort();
              break;
            }
          } else if (chunk.type === 'done') {
            break;
          }
        }
      } finally {
        clearTimeout(timer);
      }
      return { text };
    },
  };
}
