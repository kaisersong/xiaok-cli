import type { DesktopTaskEvent } from './task-types.js';
import { normalizePublicComparableText, projectNarrationSummary, separateAssistantNarration } from './assistant-narration.js';

export interface PublicTaskMessage { sourceMessageId: string; role: 'user' | 'assistant'; text: string }
/** Coordinates belong to an append-only committed task event log, not an editable message-array index. */
export function publicTaskMessageKey(kind: 'user' | 'assistant' | 'result', eventIndex = 0): string {
  return kind === 'user' ? 'user' : `${kind}:event:${eventIndex}`;
}
export function projectPublicTaskMessages(snapshot: { taskId: string; prompt: string; events: ReadonlyArray<DesktopTaskEvent> }): PublicTaskMessage[] {
  const messages: PublicTaskMessage[] = [{ sourceMessageId: publicTaskMessageKey('user'), role: 'user', text: snapshot.prompt }];
  let accumulated = '';
  for (const [index, event] of snapshot.events.entries()) {
    if (event.type === 'assistant_delta') accumulated += event.delta;
    else if (event.type === 'canvas_tool_call') accumulated = separateAssistantNarration(accumulated);
    else if (event.type === 'result') {
      const result = projectNarrationSummary(event.result, accumulated, snapshot.events);
      const text = accumulated || event.result.summary;
      if (text) messages.push({ sourceMessageId: publicTaskMessageKey('assistant', index), role: 'assistant', text });
      if (result.summary.trim() && normalizePublicComparableText(result.summary) !== normalizePublicComparableText(text)) {
        messages.push({ sourceMessageId: publicTaskMessageKey('result', index), role: 'assistant', text: result.summary });
      }
      accumulated = '';
    } else if (event.type === 'task_cancelled' || event.type === 'error') {
      const text = accumulated || (event.type === 'task_cancelled' ? event.partialText ?? '' : '');
      if (text.trim()) messages.push({ sourceMessageId: publicTaskMessageKey('assistant', index), role: 'assistant', text });
      accumulated = '';
    }
  }
  return messages;
}
