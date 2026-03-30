import type { Message } from '../../types.js';

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export function estimateTokens(messages: Message[]): number {
  let chars = 0;

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') chars += block.text.length;
      if (block.type === 'thinking') chars += block.thinking.length;
      if (block.type === 'tool_use') chars += JSON.stringify(block.input).length;
      if (block.type === 'tool_result') chars += block.content.length;
    }
  }

  return Math.ceil(chars / 4);
}

export function shouldCompact(estimatedTokens: number, contextLimit: number, threshold = 0.85): boolean {
  return estimatedTokens > contextLimit * threshold;
}

export function mergeUsage(base: UsageStats, next: UsageStats): UsageStats {
  const merged: UsageStats = {
    inputTokens: next.inputTokens,
    outputTokens: next.outputTokens,
  };

  const cacheCreationInputTokens = next.cacheCreationInputTokens ?? base.cacheCreationInputTokens;
  if (cacheCreationInputTokens !== undefined) {
    merged.cacheCreationInputTokens = cacheCreationInputTokens;
  }

  const cacheReadInputTokens = next.cacheReadInputTokens ?? base.cacheReadInputTokens;
  if (cacheReadInputTokens !== undefined) {
    merged.cacheReadInputTokens = cacheReadInputTokens;
  }

  return merged;
}

export function compactMessages(
  messages: Message[],
  placeholder = '[context compacted]',
  keepRecent = 2
): Message[] {
  if (messages.length <= keepRecent) {
    return messages;
  }

  return [
    {
      role: 'assistant',
      content: [{ type: 'text', text: placeholder }],
    },
    ...messages.slice(-keepRecent),
  ];
}
