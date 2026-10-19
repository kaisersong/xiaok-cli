import { describe, expect, it, vi } from 'vitest';
import { createDeepSeekSearchProvider } from '../../../../../src/ai/tools/connectors/search/deepseek.js';
import { SearchProviderError } from '../../../../../src/ai/tools/connectors/search/types.js';

// DeepSeek Search API 语义钉住（docs 2026-10-18）：
// POST /v1/tools/search，Bearer 鉴权，query 1-128 字符，count 1-50，
// 空结果属于成功（不计费），错误码遵循 OpenAI 兼容格式。

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('web_search.deepseek', () => {
  it('posts query with auth header and prefers the model-facing summary', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({
      results: [
        {
          rerank_score: 2.4,
          title: 'DeepSeek V4 release',
          url: 'https://example.com/a',
          snippet: 'short ui snippet',
          summary: 'model-oriented summary',
          date: '2026-10-17T00:00:00+00:00',
        },
      ],
    }));
    const provider = createDeepSeekSearchProvider({ apiKey: 'sk-x', fetchFn, endpoint: 'https://api.example/search' });
    const hits = await provider.search({ query: 'DeepSeek V4', count: 5 });

    expect(provider.name).toBe('web_search.deepseek');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/search');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-x');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ query: 'DeepSeek V4', count: 5, need_content: false });

    expect(hits).toEqual([{
      title: 'DeepSeek V4 release',
      url: 'https://example.com/a',
      snippet: 'model-oriented summary',
      publishedAt: '2026-10-17T00:00:00+00:00',
      score: 2.4,
    }]);
  });

  it('clamps count into the official 1..50 window', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ results: [] }));
    const provider = createDeepSeekSearchProvider({ apiKey: 'sk-x', fetchFn });
    await provider.search({ query: 'q', count: 500 });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((JSON.parse(init.body as string) as { count: number }).count).toBe(50);
  });

  it('returns an empty result set without throwing on no hits', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ results: [] }));
    const provider = createDeepSeekSearchProvider({ apiKey: 'sk-x', fetchFn });
    const hits = await provider.search({ query: 'q', count: 3 });
    expect(hits).toEqual([]);
  });

  it('maps 401/403 to auth and 429 to rate_limit errors', async () => {
    const provider = createDeepSeekSearchProvider({ apiKey: 'sk-x', fetchFn: async () => new Response('unauthorized', { status: 401 }) });
    await expect(provider.search({ query: 'q', count: 1 })).rejects.toMatchObject({ kind: 'auth', status: 401 });

    const limited = createDeepSeekSearchProvider({ apiKey: 'sk-x', fetchFn: async () => new Response('rate', { status: 429 }) });
    await expect(limited.search({ query: 'q', count: 1 })).rejects.toMatchObject({ kind: 'rate_limit', status: 429 });
  });

  it('maps 402 insufficient balance and other http errors to http kind without retries', async () => {
    const provider = createDeepSeekSearchProvider({ apiKey: 'sk-x', fetchFn: async () => new Response('insufficient', { status: 402, statusText: 'Payment Required' }) });
    const error = await provider.search({ query: 'q', count: 1 }).catch((e: unknown) => e as SearchProviderError);
    expect(error).toBeInstanceOf(SearchProviderError);
    expect(error).toMatchObject({ kind: 'http', status: 402 });
  });

  it('throws auth on missing api key so the registry can rebuild lazily', () => {
    expect(() => createDeepSeekSearchProvider({ apiKey: '' })).toThrow(SearchProviderError);
  });
});
