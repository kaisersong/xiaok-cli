import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../../src/types.js';

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
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).not.toHaveProperty('store');
  });

  it('projects text, images, function calls, and outputs without changing their order', async () => {
    const { buildResponsesInput } = await import('../../../src/ai/adapters/openai-responses.js');
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'before' },
          { type: 'tool_use', id: 'call_1', name: 'read', input: { path: '/tmp/a' } },
          { type: 'text', text: 'after' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'file contents' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'aGVsbG8=',
            },
          },
          { type: 'text', text: 'inspect this' },
        ],
      },
    ];

    expect(buildResponsesInput(messages, 'system prompt')).toEqual([
      {
        role: 'system',
        content: [{ type: 'input_text', text: 'system prompt' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'input_text', text: 'before' }],
      },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'read',
        arguments: '{"path":"/tmp/a"}',
      },
      {
        role: 'assistant',
        content: [{ type: 'input_text', text: 'after' }],
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: 'file contents',
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,aGVsbG8=',
          },
          { type: 'input_text', text: 'inspect this' },
        ],
      },
    ]);
  });

  it('emits interleaved message text and multiple function calls in provider order', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'before' }] },
          { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{"path":"a"}' },
          { type: 'message', content: [{ type: 'output_text', text: 'between' }] },
          { type: 'function_call', call_id: 'call_2', name: 'read', arguments: '{"path":"b"}' },
        ],
        usage: { input_tokens: 3, output_tokens: 4 },
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
    for await (const chunk of adapter.stream([], [], 'system prompt')) chunks.push(chunk);

    expect(chunks).toEqual([
      { type: 'text', delta: 'before' },
      { type: 'tool_use', id: 'call_1', name: 'read', input: { path: 'a' } },
      { type: 'text', delta: 'between' },
      { type: 'tool_use', id: 'call_2', name: 'read', input: { path: 'b' } },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } },
      { type: 'done' },
    ]);
  });

  it('sets store:false only for the exact global public OpenAI v1 origin', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return {
        ok: true,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { OpenAIResponsesAdapter } = await import('../../../src/ai/adapters/openai-responses.js');

    for (const baseUrl of [
      'https://api.openai.com/v1',
      'https://api.openai.com/v1/',
      'https://api.openai.com/v1?proxy=1',
      'https://api.openai.com.evil.example/v1',
    ]) {
      const adapter = new OpenAIResponsesAdapter('test-key', 'gpt-5', baseUrl);
      for await (const _ of adapter.stream([], [], 'system prompt')) { /* consume */ }
    }

    expect(bodies[0]).toMatchObject({ store: false });
    expect(bodies[1]).toMatchObject({ store: false });
    expect(bodies[2]).not.toHaveProperty('store');
    expect(bodies[3]).not.toHaveProperty('store');
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
