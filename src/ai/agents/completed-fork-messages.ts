import type { Message } from '../../types.js';

/** A live delegation call must never inherit its parent's unfinished tool batch. */
export function completedForkMessages(messages: readonly Message[]): readonly Message[] {
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    const calls = message.content.filter(block => block.type === 'tool_use');
    if (!calls.length) continue;
    const next = messages[index + 1];
    const results = next?.role === 'user' ? next.content.filter(block => block.type === 'tool_result') : [];
    const ids = new Set(results.map(block => block.tool_use_id));
    if (results.length !== calls.length || ids.size !== calls.length || calls.some(call => !ids.has(call.id))) return messages.slice(0, index);
  }
  return messages;
}
