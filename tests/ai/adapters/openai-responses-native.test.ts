import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compactOpenAIResponsesContext,
  createStatelessOpenAIResponse,
} from '../../../src/ai/adapters/openai-responses-native.js';

const BASE_URL = 'https://api.openai.com/v1';

function ordinaryPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'resp_initial',
    object: 'response',
    created_at: 1_721_000_000,
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'synthetic response' }],
      },
    ],
    usage: {
      input_tokens: 12,
      output_tokens: 5,
      total_tokens: 17,
      input_tokens_details: { cached_tokens: 3 },
    },
    ...overrides,
  };
}

function compactPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'resp_compact',
    object: 'response.compaction',
    created_at: 1_721_000_001,
    output: [
      { type: 'compaction', encrypted_content: 'opaque-canonical-context' },
    ],
    usage: {
      input_tokens: 21,
      output_tokens: 2,
      total_tokens: 23,
      input_tokens_details: { cached_tokens: 8 },
    },
    ...overrides,
  };
}

function jsonResponse(
  payload: Record<string, unknown>,
  init: ResponseInit = { status: 200 },
): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

function baseParams(input: Array<Record<string, unknown>> = [{ role: 'user', content: 'hello' }]) {
  return {
    apiKey: 'test-api-key',
    baseUrl: BASE_URL,
    model: 'gpt-test',
    input,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createStatelessOpenAIResponse', () => {
  it('posts exactly to /v1/responses, forces store:false, and sends only modeled headers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(ordinaryPayload()));
    vi.stubGlobal('fetch', fetchMock);
    const input = [{ role: 'user', content: 'synthetic input' }];
    const tools = [{ type: 'function', name: 'fixed_lookup', parameters: { type: 'object' } }];

    await createStatelessOpenAIResponse({
      ...baseParams(input),
      baseUrl: `${BASE_URL}/`,
      tools,
      organization: 'org_test',
      project: 'proj_test',
      requestId: 'req_test',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.redirect).toBe('error');
    expect(init.method).toBe('POST');
    expect(init.headers).toBeInstanceOf(Headers);
    expect(Object.fromEntries(new Headers(init.headers).entries())).toEqual({
      authorization: 'Bearer test-api-key',
      'content-type': 'application/json',
      'openai-organization': 'org_test',
      'openai-project': 'proj_test',
      'x-client-request-id': 'req_test',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'gpt-test',
      input,
      tools,
      store: false,
    });
  });

  it.each([
    'http://api.openai.com/v1',
    'https://api.openai.com.evil/v1',
    'https://api.openai.com./v1',
    'https://user:pass@api.openai.com/v1',
    'https://api.openai.com:8443/v1',
    'https://api.openai.com/v1?tenant=evil',
    'https://api.openai.com/v1#fragment',
    'https://api.openai.com/%76%31',
    'https://api.openai.com/v1/responses',
    'https://API.openai.com/v1',
  ])('rejects non-exact public OpenAI base URL before fetch: %s', async (baseUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(createStatelessOpenAIResponse({
      ...baseParams(),
      baseUrl,
    })).rejects.toThrow(/baseUrl/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { apiKey: '', model: 'gpt-test', input: [{}] },
    { apiKey: 'test-api-key', model: '   ', input: [{}] },
    { apiKey: 'test-api-key', model: 'gpt-test', input: [] },
  ])('rejects empty required inputs before fetch', async ({ apiKey, model, input }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(createStatelessOpenAIResponse({
      apiKey,
      baseUrl: BASE_URL,
      model,
      input,
    })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates an external abort through the merged request signal', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          reject(capturedSignal?.reason);
        }, { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const pending = createStatelessOpenAIResponse({
      ...baseParams(),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new DOMException('caller stopped', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(capturedSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('reports a distinct timeout after five minutes without retrying', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>(
      (_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const pending = createStatelessOpenAIResponse(baseParams());
    const expectation = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    await expectation;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([400, 429, 500])('does not retry HTTP %i', async (status) => {
    const fetchMock = vi.fn(async () => new Response('failure', { status }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createStatelessOpenAIResponse(baseParams())).rejects.toThrow(
      new RegExp(`HTTP ${status}`),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects oversized ordinary response before parsing', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(ordinaryPayload(), {
      headers: { 'content-length': String(32 * 1024 * 1024 + 1) },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createStatelessOpenAIResponse(baseParams())).rejects.toThrow(/32 MiB/i);
  });

  it('enforces the 32 MiB limit for chunked responses without Content-Length', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 33; index += 1) {
          controller.enqueue(new Uint8Array(1024 * 1024));
        }
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    await expect(createStatelessOpenAIResponse(baseParams())).rejects.toThrow(/32 MiB/i);
  });

  it('fails closed when fetch provides no readable response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      text: async () => JSON.stringify(ordinaryPayload()),
    }) as Response));

    await expect(createStatelessOpenAIResponse(baseParams())).rejects.toThrow(/body/i);
  });

  it.each([
    'not-json',
    JSON.stringify(ordinaryPayload({ id: '' })),
    JSON.stringify(ordinaryPayload({ object: 'response.compaction' })),
    JSON.stringify(ordinaryPayload({ created_at: -1 })),
    JSON.stringify(ordinaryPayload({ output: [] })),
    JSON.stringify(ordinaryPayload({ output: [{ nope: true }] })),
    JSON.stringify(ordinaryPayload({ usage: { input_tokens: -1, output_tokens: 1, total_tokens: 0 } })),
  ])('rejects malformed ordinary response contract', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    await expect(createStatelessOpenAIResponse(baseParams())).rejects.toThrow();
  });

  it('returns canonical output in wire order with normalized usage and elapsed time', async () => {
    const output = [
      { type: 'reasoning', encrypted_content: 'opaque-reasoning' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'safe' }] },
      { type: 'function_call', call_id: 'call_1', name: 'fixed_lookup', arguments: '{}' },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(ordinaryPayload({ output }))));

    const result = await createStatelessOpenAIResponse(baseParams());

    expect(result.output).toEqual(output);
    expect(result.responseId).toBe('resp_initial');
    expect(result.createdAt).toBe(1_721_000_000);
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
      cachedInputTokens: 3,
    });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('does not mutate deeply frozen caller input', async () => {
    const input = deepFreeze([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'immutable' }],
      },
    ]);
    const before = JSON.stringify(input);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(ordinaryPayload())));

    await createStatelessOpenAIResponse(baseParams(input as Array<Record<string, unknown>>));

    expect(JSON.stringify(input)).toBe(before);
  });

  it('does not mutate deeply frozen caller input when response validation fails', async () => {
    const input = deepFreeze([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'immutable-on-error' }],
      },
    ]);
    const before = JSON.stringify(input);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })));

    await expect(createStatelessOpenAIResponse(
      baseParams(input as Array<Record<string, unknown>>),
    )).rejects.toThrow(/valid JSON/i);

    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('compactOpenAIResponsesContext', () => {
  it('posts exactly to /v1/responses/compact with only model and input', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(compactPayload()));
    vi.stubGlobal('fetch', fetchMock);
    const input = [
      { role: 'user', content: 'synthetic input' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
    ];

    await compactOpenAIResponsesContext({
      ...baseParams(input),
      organization: 'org_test',
      project: 'proj_test',
      requestId: 'req_compact',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses/compact');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'gpt-test',
      input,
    });
  });

  it.each([
    [
      { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
      { type: 'function_call', call_id: 'call_1', name: 'two', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'fixed' },
    ],
    [
      { type: 'function_call_output', call_id: 'orphan', output: 'fixed' },
    ],
    [
      { type: 'function_call', call_id: 'missing', name: 'one', arguments: '{}' },
    ],
    [
      { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'fixed' },
      { type: 'function_call_output', call_id: 'call_1', output: 'duplicate' },
    ],
    [
      { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1' },
    ],
    [
      { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: undefined },
    ],
    [
      { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: null },
    ],
    [
      { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 42 },
    ],
    [
      { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: {} },
    ],
    [
      { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: [] },
    ],
    [
      { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: [{ type: 'input_text' }],
      },
    ],
    [
      { type: 'function_call_output', call_id: 'call_1', output: 'too early' },
      { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
    ],
    [
      { type: 'function_call', call_id: ' call_1 ', name: 'one', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'wire IDs differ' },
    ],
  ])('rejects duplicate, orphan, or missing tool history before fetch', async (...input) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(compactOpenAIResponsesContext({
      ...baseParams(input as Array<Record<string, unknown>>),
    })).rejects.toThrow(/function_call/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts documented string and typed content-array function outputs', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(compactPayload()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(compactOpenAIResponsesContext(baseParams([
      { type: 'function_call', call_id: 'call_text', name: 'one', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_text', output: 'fixed' },
      { type: 'function_call', call_id: 'call_content', name: 'two', arguments: '{}' },
      {
        type: 'function_call_output',
        call_id: 'call_content',
        output: [
          { type: 'input_text', text: 'fixed text' },
          { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' },
          { type: 'input_file', file_data: 'ZmlsZQ==', filename: 'result.txt' },
        ],
      },
    ]))).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects malformed canonical boundaries and validates all tool pairs after the last boundary', async () => {
    const malformedBoundaryFetch = vi.fn();
    vi.stubGlobal('fetch', malformedBoundaryFetch);

    await expect(compactOpenAIResponsesContext(baseParams([
      { type: 'compaction' },
      { role: 'user', content: 'continue' },
    ]))).rejects.toThrow(/compaction/i);
    expect(malformedBoundaryFetch).not.toHaveBeenCalled();

    const postBoundaryFetch = vi.fn();
    vi.stubGlobal('fetch', postBoundaryFetch);
    await expect(compactOpenAIResponsesContext(baseParams([
      { type: 'function_call_output', call_id: 'legacy-orphan', output: 'opaque legacy' },
      { type: 'compaction', encrypted_content: 'existing-boundary' },
      { type: 'function_call', call_id: 'new-call', name: 'one', arguments: '{}' },
    ]))).rejects.toThrow(/function_call/i);
    expect(postBoundaryFetch).not.toHaveBeenCalled();
  });

  it('accepts canonical compaction history without revalidating pre-boundary tool pairs', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(compactPayload()));
    vi.stubGlobal('fetch', fetchMock);
    const input = [
      { type: 'function_call_output', call_id: 'legacy-orphan', output: 'fixed' },
      { type: 'compaction', encrypted_content: 'existing-boundary' },
      { role: 'user', content: 'continue' },
    ];

    await expect(compactOpenAIResponsesContext(baseParams(input))).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects oversized compact response before parsing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(compactPayload(), {
      headers: { 'content-length': String(32 * 1024 * 1024 + 1) },
    })));

    await expect(compactOpenAIResponsesContext(baseParams())).rejects.toThrow(/32 MiB/i);
  });

  it.each([
    compactPayload({ object: 'response' }),
    compactPayload({ output: [] }),
    compactPayload({ output: [{ type: 'compaction', encrypted_content: '' }] }),
    compactPayload({ output: [{ type: 'message', content: [] }] }),
    compactPayload({ usage: null }),
  ])('rejects malformed compact response contract', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(payload)));

    await expect(compactOpenAIResponsesContext(baseParams())).rejects.toThrow();
  });

  it('returns all canonical compact output items without reordering or redaction', async () => {
    const output = [
      { type: 'reasoning', encrypted_content: 'opaque-before' },
      { type: 'compaction', encrypted_content: 'opaque-canonical-context' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'after' }] },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(compactPayload({ output }))));

    const result = await compactOpenAIResponsesContext(baseParams());

    expect(result.output).toEqual(output);
    expect(result.responseId).toBe('resp_compact');
    expect(result.createdAt).toBe(1_721_000_001);
    expect(result.usage).toEqual({
      inputTokens: 21,
      outputTokens: 2,
      totalTokens: 23,
      cachedInputTokens: 8,
    });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
