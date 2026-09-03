import { createAdapter } from '../../src/ai/models.js';
import type { Message } from '../../src/types.js';
import { loadConfig } from '../../src/utils/config.js';
import type { LoopLLMPort } from './loop-llm-port.js';
import { randomUUID } from 'node:crypto';
import { streamStatelessSideCallProviderConversation } from '../../src/ai/runtime/provider-conversation-authorization.js';
import { DesktopExecutionCoordinator } from './desktop-execution-coordinator.js';

const DEFAULT_QUEUE_TIMEOUT_MS = 30_000;
const DEFAULT_COMPLETION_TIMEOUT_MS = 30_000;

interface PhaseAbort {
  signal: AbortSignal;
  abort(reason: Error): void;
  dispose(): void;
}

export function createDesktopLoopLLMPort(executionCoordinator = new DesktopExecutionCoordinator()): LoopLLMPort {
  return {
    async complete(input) {
      const config = await loadConfig();
      const adapter = createAdapter(config);
      const messages: Message[] = [
        { role: 'user', content: [{ type: 'text', text: input.userMessage }] },
      ];
      const queueAbort = createPhaseAbort(
        input.signal,
        input.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS,
        'loop_llm_queue_timeout',
      );
      try {
        return await executionCoordinator.run(queueAbort.signal, async () => {
          queueAbort.dispose();
          const completionAbort = createPhaseAbort(
            input.signal,
            input.completionTimeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS,
            'loop_llm_timeout',
          );
          let text = '';
          try {
            for await (const chunk of streamStatelessSideCallProviderConversation({
              adapter,
              messages,
              tools: [],
              systemPrompt: input.systemPrompt,
              options: { signal: completionAbort.signal },
              invocationId: `inv_${randomUUID()}`,
            })) {
              if (chunk.type === 'text') {
                text += chunk.delta;
                if (text.length > input.maxTokens * 4) {
                  const error = new Error('loop_llm_output_limit');
                  completionAbort.abort(error);
                  throw error;
                }
              } else if (chunk.type === 'done') {
                break;
              }
            }
          } catch (error) {
            if (completionAbort.signal.aborted) throw abortReason(completionAbort.signal);
            throw error;
          } finally {
            completionAbort.dispose();
          }
          return { text };
        });
      } finally {
        queueAbort.dispose();
      }
    },
  };
}

function createPhaseAbort(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutReason: string,
): PhaseAbort {
  const controller = new AbortController();
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_COMPLETION_TIMEOUT_MS;
  const forwardParentAbort = () => {
    controller.abort(parentSignal ? abortReason(parentSignal) : new Error('loop_llm_aborted'));
  };
  if (parentSignal?.aborted) {
    forwardParentAbort();
  } else {
    parentSignal?.addEventListener('abort', forwardParentAbort, { once: true });
  }
  const timer = controller.signal.aborted
    ? undefined
    : setTimeout(() => controller.abort(new Error(timeoutReason)), duration);
  timer?.unref?.();
  return {
    signal: controller.signal,
    abort: reason => controller.abort(reason),
    dispose() {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener('abort', forwardParentAbort);
    },
  };
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}
