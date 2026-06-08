import { afterEach, describe, expect, it, vi } from 'vitest';

describe('OpenAIResponsesAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('emits text and usage from a non-streaming responses payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'hello from responses',
              },
            ],
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 4,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { OpenAIResponsesAdapter } = await import('../../../src/ai/adapters/openai-responses.js');
    const adapter = new OpenAIResponsesAdapter(
      'test-key',
      'gemini-2.5-pro',
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system prompt')) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({ type: 'text', delta: 'hello from responses' });
    expect(chunks).toContainEqual({
      type: 'usage',
      usage: {
        inputTokens: 10,
        outputTokens: 4,
      },
    });
    expect(chunks.at(-1)).toEqual({ type: 'done' });
  });

  it('propagates external abort signal to fetch requests', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return {
        ok: true,
        json: async () => ({
          output: [
            { type: 'message', content: [{ type: 'output_text', text: 'ok' }] },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { OpenAIResponsesAdapter } = await import('../../../src/ai/adapters/openai-responses.js');
    const adapter = new OpenAIResponsesAdapter(
      'test-key',
      'gemini-2.5-pro',
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );

    const controller = new AbortController();
    for await (const _ of adapter.stream([], [], 'system prompt', { signal: controller.signal } as never)) { /* consume */ }

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);
    controller.abort();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('retries when the connection is dropped with "Premature close"', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) {
        throw Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' });
      }
      return {
        ok: true,
        json: async () => ({
          output: [
            { type: 'message', content: [{ type: 'output_text', text: 'recovered' }] },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { OpenAIResponsesAdapter } = await import('../../../src/ai/adapters/openai-responses.js');
    const adapter = new OpenAIResponsesAdapter(
      'test-key',
      'gemini-2.5-pro',
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );

    const streamPromise = (async () => {
      const chunks = [];
      for await (const chunk of adapter.stream([], [], 'system prompt')) {
        chunks.push(chunk);
      }
      return chunks;
    })();

    await vi.runAllTimersAsync();
    const chunks = await streamPromise;

    expect(calls).toBe(2);
    expect(chunks).toContainEqual({ type: 'text', delta: 'recovered' });
    vi.useRealTimers();
  });

  it('does not retry AbortError failures', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls += 1;
      throw Object.assign(new Error('user aborted'), { name: 'AbortError' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { OpenAIResponsesAdapter } = await import('../../../src/ai/adapters/openai-responses.js');
    const adapter = new OpenAIResponsesAdapter(
      'test-key',
      'gemini-2.5-pro',
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );

    let caughtError: Error | undefined;
    const streamPromise = (async () => {
      try {
        for await (const _ of adapter.stream([], [], 'system prompt')) { /* drain */ }
      } catch (e) {
        caughtError = e as Error;
      }
    })();

    await vi.runAllTimersAsync();
    await streamPromise;

    expect(calls).toBe(1);
    expect(caughtError?.name).toBe('AbortError');
    vi.useRealTimers();
  });
});
