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
});
