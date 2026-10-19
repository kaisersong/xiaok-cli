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

  it('maps 401 to auth and 429 to rate_limit errors', async () => {
    const provider = createDeepSeekSearchProvider({ apiKey: 'sk-x', fetchFn: async () => new Response('unauthorized', { status: 401 }) });
    await expect(provider.search({ query: 'q', count: 1 })).rejects.toMatchObject({ kind: 'auth', status: 401 });

    const limited = createDeepSeekSearchProvider({ apiKey: 'sk-x', fetchFn: async () => new Response('rate', { status: 429 }) });
    await expect(limited.search({ query: 'q', count: 1 })).rejects.toMatchObject({ kind: 'rate_limit', status: 429 });
  });

  it('maps 403 to http (security-policy rejection, not a credential fault)', async () => {
    // 官方 guides/search #errors：403 = 请求被安全策略拒绝。标成 auth 会误导
    // 用户去更换有效 key（评审 P2 #8）。
    const provider = createDeepSeekSearchProvider({ apiKey: 'sk-x', fetchFn: async () => new Response('forbidden', { status: 403 }) });
    await expect(provider.search({ query: 'q', count: 1 })).rejects.toMatchObject({
      kind: 'http',
      status: 403,
    });
  });

  it('rejects malformed keys at construction with a fixed message that never echoes the key', async () => {
    // Node 对含换行的 Authorization 头的校验错误会把 `Bearer <key>` 原文放进
    // 消息（评审 BLOCK #1）；构造期必须拒绝，且错误文本不能含 key 片段。
    const canary = 'sk-CANARYREVIEW\nbearer-header-copy';
    const fetchFn = vi.fn(async () => jsonResponse({ results: [] }));
    expect(() => createDeepSeekSearchProvider({ apiKey: canary, fetchFn })).toThrow(SearchProviderError);
    try {
      createDeepSeekSearchProvider({ apiKey: canary, fetchFn });
      expect.unreachable('construction must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchProviderError);
      expect((error as Error).message).not.toContain('CANARYREVIEW');
      expect((error as Error).message).toBe('invalid deepseek api key format');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('treats 200 responses with abnormal shapes as parse errors, not empty results', async () => {
    // 只有合法的 results:[] 才是无命中；200+{} / {results:'nope'} /
    // {error:{...}} 是异常结构，进 parse 错误而不是伪装成空结果（评审 P2 #7）。
    for (const body of [{}, { results: 'nope' }, { error: { message: 'boom' } }]) {
      const provider = createDeepSeekSearchProvider({ apiKey: 'sk-x', fetchFn: async () => jsonResponse(body) });
      await expect(provider.search({ query: 'q', count: 1 })).rejects.toMatchObject({ kind: 'parse' });
    }
  });

  it('drops null entries from results instead of crashing on them', async () => {
    const provider = createDeepSeekSearchProvider({
      apiKey: 'sk-x',
      fetchFn: async () => jsonResponse({
        results: [
          null,
          { url: 'https://example.com/ok', title: 'ok', summary: 'ok summary' },
          42,
          'nope',
        ],
      }),
    });
    const hits = await provider.search({ query: 'q', count: 5 });
    expect(hits).toEqual([{ title: 'ok', url: 'https://example.com/ok', snippet: 'ok summary' }]);
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
