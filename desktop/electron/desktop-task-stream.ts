import { randomUUID } from 'node:crypto';
import type { Message, StreamChunk } from '../../src/types.js';
import { streamDesktopTaskProviderConversation } from '../../src/ai/runtime/provider-conversation-authorization.js';
import { recoverModelStream, type ModelRecoveryNotice, type ModelRecoveryPolicy } from '../../src/ai/runtime/model-stream-recovery.js';

type Request = Parameters<typeof streamDesktopTaskProviderConversation>[0];
export type DesktopTaskRequestPreparer = (request: Request) => Promise<Request>;
type Input = Request & {
  deadline: number;
  beforeRequest?: () => Promise<void>;
  prepareRequest?: DesktopTaskRequestPreparer;
  onInvocation?: (id: string) => void;
  onRecovery?: (notice: ModelRecoveryNotice & { summaryOnly: boolean }) => void | Promise<void>;
  canRecover?: () => boolean;
  summaryOnly?: boolean;
  policy?: ModelRecoveryPolicy;
};

/** Recover provider reads, never task/tool execution or authorization/persistence. */
export async function* streamDesktopTaskRecovery(input: Input): AsyncGenerator<StreamChunk> {
  const deadline = new AbortController();
  const signal = input.options?.signal ? AbortSignal.any([input.options.signal, deadline.signal]) : deadline.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const armDeadline = () => {
    const remaining = input.deadline - Date.now();
    if (remaining <= 0) deadline.abort(new Error('desktop_tool_loop_deadline_exceeded'));
    else if (Number.isFinite(remaining)) timer = setTimeout(armDeadline, Math.min(remaining, 2 ** 31 - 1));
  };
  armDeadline();
  let messages = input.messages;
  let invocationId = input.invocationId;
  let prepared = false, prefix = '', sawTool = false;
  let summaryOnly = Boolean(input.summaryOnly);
  try {
    yield* recoverModelStream({ signal, policy: input.policy,
      shouldRetry: () => prepared,
      onRetry: async notice => {
        if (!summaryOnly && !sawTool && prefix.trim() && input.canRecover?.()) summaryOnly = true;
        // These fragments were visible, but no tool from this interrupted request ran.
        if (prefix.trim()) messages = [...input.messages, { role: 'user', content: [{ type: 'text', text:
          'The previous model response was interrupted. The following is partial visible output, not a completed answer or an executed tool call. Continue from the completed tool results already in history; do not repeat completed operations or the delivered text. '
          + (summaryOnly ? 'Tools are disabled; finish the summary using existing evidence. ' : '')
          + JSON.stringify({ partialOutput: prefix.slice(-12000) }) }] }];
        sawTool = false;
        invocationId = `inv_${randomUUID()}`;
        await input.onRecovery?.({ ...notice, summaryOnly });
      },
      open: requestSignal => (async function*() {
        prepared = false;
        await input.beforeRequest?.();
        requestSignal.throwIfAborted();
        const request = { ...input, messages, tools: summaryOnly ? [] : input.tools, invocationId,
          options: { ...input.options, signal: requestSignal } };
        const current = input.prepareRequest ? await input.prepareRequest(request) : request;
        requestSignal.throwIfAborted();
        input.onInvocation?.(invocationId);
        prepared = true;
        let text = '';
        for await (const chunk of streamDesktopTaskProviderConversation(current)) {
          if (chunk.type !== 'usage') requestSignal.throwIfAborted();
          if (chunk.type === 'text') { prefix = (prefix + chunk.delta).slice(-12000); text += chunk.delta; }
          if (chunk.type === 'done' && summaryOnly && !text.trim()) throw new Error('summary_recovery_empty');
          if (chunk.type === 'tool_use') {
            if (summaryOnly) throw new Error('summary_recovery_tool_forbidden');
            sawTool = true;
          }
          yield chunk;
        }
        if (summaryOnly && !text.trim()) throw new Error('summary_recovery_empty');
      })(),
    });
  } catch (error) {
    if (signal.aborted && (typeof signal.reason !== 'object' || signal.reason === null)) throw new Error('task cancelled');
    throw error;
  } finally { clearTimeout(timer); }
}
