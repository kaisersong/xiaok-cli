import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { createDesktopLoopLLMPort } from '../../electron/loop-llm-port-impl.js';

const providerMocks = vi.hoisted(() => ({
  stream: vi.fn(),
}));

vi.mock('../../../src/utils/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({ provider: 'test' }),
}));

vi.mock('../../../src/ai/models.js', () => ({
  createAdapter: vi.fn(() => ({ stream: vi.fn() })),
}));

vi.mock('../../../src/ai/runtime/provider-conversation-authorization.js', () => ({
  streamStatelessSideCallProviderConversation: (...args: unknown[]) => providerMocks.stream(...args),
}));

function completionInput(overrides: Record<string, unknown> = {}) {
  return {
    model: 'fast' as const,
    systemPrompt: 'return text',
    userMessage: 'input',
    maxTokens: 100,
    temperature: 0,
    ...overrides,
  };
}

function streamChunks(chunks: Array<{ type: string; delta?: string }>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function waitForAbortStream(input: { options?: { signal?: AbortSignal } }) {
  return {
    async *[Symbol.asyncIterator]() {
      const signal = input.options?.signal;
      await new Promise<never>((_resolve, reject) => {
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  };
}

describe('Desktop Loop LLM port timeout boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    providerMocks.stream.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not spend the completion budget while waiting for the shared execution lease', async () => {
    const coordinator = new DesktopExecutionCoordinator({ capacity: 1 });
    let releaseLease!: () => void;
    const occupied = coordinator.run(undefined, () => new Promise<void>(resolve => { releaseLease = resolve; }));
    await Promise.resolve();
    providerMocks.stream.mockImplementation(() => streamChunks([
      { type: 'text', delta: 'ok' },
      { type: 'done' },
    ]));
    const port = createDesktopLoopLLMPort(coordinator);

    const completion = port.complete(completionInput({ queueTimeoutMs: 300_000, completionTimeoutMs: 60_000 }));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(providerMocks.stream).not.toHaveBeenCalled();
    releaseLease();

    await expect(completion).resolves.toEqual({ text: 'ok' });
    await occupied;
  });

  it('reports stable queue and completion timeout reasons', async () => {
    const coordinator = new DesktopExecutionCoordinator({ capacity: 1 });
    let releaseLease!: () => void;
    const occupied = coordinator.run(undefined, () => new Promise<void>(resolve => { releaseLease = resolve; }));
    await Promise.resolve();
    const port = createDesktopLoopLLMPort(coordinator);
    const queueTimeout = port.complete(completionInput({ queueTimeoutMs: 20, completionTimeoutMs: 60_000 }));
    const queueExpectation = expect(queueTimeout).rejects.toThrow('loop_llm_queue_timeout');
    await vi.advanceTimersByTimeAsync(20);
    await queueExpectation;
    releaseLease();
    await occupied;

    providerMocks.stream.mockImplementation(waitForAbortStream);
    const completionTimeout = port.complete(completionInput({ completionTimeoutMs: 20 }));
    const completionExpectation = expect(completionTimeout).rejects.toThrow('loop_llm_timeout');
    await vi.advanceTimersByTimeAsync(20);
    await completionExpectation;
  });

  it('propagates caller cancellation and reports output budget cancellation explicitly', async () => {
    const port = createDesktopLoopLLMPort(new DesktopExecutionCoordinator({ capacity: 1 }));
    const controller = new AbortController();
    providerMocks.stream.mockImplementation(waitForAbortStream);
    const cancelled = port.complete(completionInput({ signal: controller.signal }));
    const cancelledExpectation = expect(cancelled).rejects.toThrow('executor_timeout');
    await Promise.resolve();
    controller.abort(new Error('executor_timeout'));
    await cancelledExpectation;

    providerMocks.stream.mockImplementation(() => streamChunks([{ type: 'text', delta: 'x'.repeat(401) }]));
    await expect(port.complete(completionInput({ maxTokens: 100 })))
      .rejects.toThrow('loop_llm_output_limit');
  });
});
