import { randomUUID } from 'node:crypto';
import type { Message, StreamChunk } from '../../src/types.js';
import { streamDesktopTaskProviderConversation } from '../../src/ai/runtime/provider-conversation-authorization.js';

type Input = Parameters<typeof streamDesktopTaskProviderConversation>[0] & {
  deadline: number;
  canRecover?: () => boolean;
  onRecovery?: () => void;
  onInvocation?: (id: string) => void;
  summaryOnly?: boolean;
};
function isDisconnect(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === 'AbortError') return false;
  const code = (error as Error & { code?: string }).code;
  return /^(ECONNRESET|EPIPE|ERR_STREAM_PREMATURE_CLOSE|UND_ERR_SOCKET)$/.test(code ?? '')
    || /^(terminated|socket hang up|fetch failed|Premature close)$/i.test(error.message);
}

/** Only provider next() errors are recoverable; consumer/authorization failures escape. */
export async function* streamDesktopSummaryRecovery(input: Input): AsyncGenerator<StreamChunk> {
  let messages = input.messages;
  let recovering = Boolean(input.summaryOnly);
  let invocationId = input.invocationId;
  let prefix = '';
  let sawTool = false;
  for (;;) {
    input.options?.signal?.throwIfAborted();
    if (Date.now() >= input.deadline) throw new Error('summary_recovery_deadline');
    input.onInvocation?.(invocationId);
    const iterator = streamDesktopTaskProviderConversation({ ...input, messages,
      tools: recovering ? [] : input.tools, invocationId })[Symbol.asyncIterator]();
    let restart = false;
    let recoveredText = '';
    try {
      for (;;) {
        let next: IteratorResult<StreamChunk>;
        try { next = await iterator.next(); }
        catch (error) {
          input.options?.signal?.throwIfAborted();
          if (recovering || sawTool || !prefix.trim() || !isDisconnect(error)
            || Date.now() >= input.deadline || !input.canRecover?.()) throw error;
          recovering = true;
          input.onRecovery?.();
          messages = [...messages, { role: 'assistant', content: [{ type: 'text', text: prefix }] },
            { role: 'user', content: [{ type: 'text', text: 'The connection interrupted your response. Continue directly after the text already delivered above; do not repeat it. Use the existing completed subtask results to finish the requested summary. Tools are disabled: do not spawn, repeat, or claim new actions. If evidence is insufficient, explicitly state the remaining limitation.' }] }];
          invocationId = `inv_${randomUUID()}`;
          restart = true;
          break;
        }
        if (next.done) break;
        const chunk = next.value;
        // Account provider-reported cost even when cancellation won the turn.
        if (chunk.type !== 'usage') input.options?.signal?.throwIfAborted();
        if (chunk.type === 'tool_use') {
          if (recovering) throw new Error('summary_recovery_tool_forbidden');
          sawTool = true;
        }
        if (chunk.type === 'text') {
          prefix += chunk.delta;
          if (recovering) recoveredText += chunk.delta;
        }
        yield chunk;
      }
    } finally { await iterator.return?.(); }
    if (restart) continue;
    if (input.options?.signal?.aborted) {
      if (input.options.signal.reason instanceof Error) throw input.options.signal.reason;
      // Keep legacy string cancellation reasons normalized by the outer loop.
      return;
    }
    if (recovering && !recoveredText.trim()) throw new Error('summary_recovery_empty');
    return;
  }
}
