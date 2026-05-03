import type { Message } from '../../types.js';

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface CompactionSummary {
  text: string;
  replacedMessages: number;
}

export function estimateTokens(messages: Message[]): number {
  let chars = 0;

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') chars += block.text.length;
      if (block.type === 'image') chars += Math.ceil(block.source.data.length / 8);
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
    inputTokens: next.inputTokens > 0 ? next.inputTokens : base.inputTokens,
    outputTokens: next.outputTokens > 0 ? next.outputTokens : base.outputTokens,
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

function takeUnique(entries: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const entry of entries) {
    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(normalized);
    if (results.length >= maxItems) break;
  }
  return results;
}

export function summarizeMessagesForCompaction(messages: Message[]): CompactionSummary {
  const rawUserIntents: string[] = [];
  const rawAssistantOutputs: string[] = [];
  const rawToolUses: string[] = [];

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text' && message.role === 'user') {
        rawUserIntents.push(block.text);
      }
      if (block.type === 'text' && message.role === 'assistant') {
        rawAssistantOutputs.push(block.text);
      }
      if (block.type === 'tool_use') {
        rawToolUses.push(`${block.name}(${JSON.stringify(block.input)})`);
      }
    }
  }

  const userIntents = takeUnique(rawUserIntents, 3);
  const assistantOutputs = takeUnique(rawAssistantOutputs, 3);
  const toolUses = takeUnique(rawToolUses, 4);

  const lines = ['[context compacted summary]'];
  if (userIntents.length > 0) {
    lines.push(`user intents: ${userIntents.join(' | ')}`);
  }
  if (assistantOutputs.length > 0) {
    lines.push(`assistant outputs: ${assistantOutputs.join(' | ')}`);
  }
  if (toolUses.length > 0) {
    lines.push(`tool activity: ${toolUses.join(' | ')}`);
  }

  return {
    text: lines.join('\n'),
    replacedMessages: messages.length,
  };
}

export function compactMessages(
  messages: Message[],
  placeholder = '[context compacted]',
  keepRecent = 2,
): { messages: Message[]; summary: CompactionSummary } {
  if (messages.length <= keepRecent) {
    return {
      messages,
      summary: {
        text: placeholder,
        replacedMessages: 0,
      },
    };
  }

  const compactedMessages = messages.slice(0, -keepRecent);
  const summary = summarizeMessagesForCompaction(compactedMessages);

  return {
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: summary.text || placeholder }],
      },
      ...messages.slice(-keepRecent),
    ],
    summary,
  };
}

const DEFAULT_TOOL_RESULT_LIMIT = 8000;

export function truncateToolResult(content: string, limit = DEFAULT_TOOL_RESULT_LIMIT): string {
  if (content.length <= limit) return content;
  const kept = content.slice(0, limit);
  const omitted = content.length - limit;
  return `${kept}\n...[truncated ${omitted} chars]`;
}
