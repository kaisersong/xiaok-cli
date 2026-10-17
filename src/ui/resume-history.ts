import type { Message } from '../types.js';
import type { CompactionRecord } from '../ai/runtime/session-graph.js';

/** Replay projection only; runtime and persisted messages remain authoritative. */
export function getResumeHistoryMessages(
  messages: Message[],
  compactions: readonly CompactionRecord[] = [],
): Message[] {
  const first = messages[0];
  const latest = compactions.at(-1);
  // Compaction replaces the prefix with exactly one synthetic user text block.
  // A heading alone is not evidence that user-authored text is internal.
  if (latest?.summary && latest.replacedMessages > 0
    && first?.role === 'user' && first.content.length === 1
    && first.content[0].type === 'text' && first.content[0].text === latest.summary) {
    return messages.slice(1);
  }
  return messages;
}
