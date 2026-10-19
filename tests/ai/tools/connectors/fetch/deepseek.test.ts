import { describe, expect, it, vi } from 'vitest';
import { createDeepSeekFetchProvider } from '../../../../../src/ai/tools/connectors/fetch/deepseek.js';
import { FetchProviderError } from '../../../../../src/ai/tools/connectors/fetch/types.js';

// DeepSeek Fetch API 语义钉住（docs 2026-10-18）：
// POST /v1/tools/fetch {url} → {title, content(markdown)}；
// 404 = 无可用正文；URL 合法性由远端校验，本地不复刻规则。

describe('web_fetch.deepseek', () => {
  it('posts the url with auth header and returns markdown content', async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ title: 'Example', content: 'Body **markdown**.' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const provider = createDeepSeekFetchProvider({ apiKey: 'sk-x', fetchFn, endpoint: 'https://api.example/fetch' });
    const result = await provider.fetch({ url: 'https://example.com/article', maxChars: 1000 });

    expect(provider.name).toBe('web_fetch.deepseek');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/fetch');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-x');
    expect(init.body).toBe(JSON.stringify({ url: 'https://example.com/article' }));
    expect(result).toEqual({
      url: 'https://example.com/article',
      contentType: 'text/markdown',
      content: '# Example\n\nBody **markdown**.',
      source: 'web_fetch.deepseek',
    });
  });

  it('passes remote URL validation through (self-signed fetch url is sent verbatim)', async () => {
    // 远端负责校验（8192 长度 / 凭据 / 协议），本地不做第二套规则。
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ title: '', content: 'ok' }), { status: 200 }));
    const provider = createDeepSeekFetchProvider({ apiKey: 'sk-x', fetchFn });
    const result = await provider.fetch({ url: 'https://user:pw@example.com/page', maxChars: 100 });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(result.content).toContain('ok');
  });

  it('treats empty content as unusable and throws instead of pretending success', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ title: 'x', content: '' }), { status: 200 }));
    const provider = createDeepSeekFetchProvider({ apiKey: 'sk-x', fetchFn });
    await expect(provider.fetch({ url: 'https://example.com', maxChars: 100 }))
      .rejects.toMatchObject({ kind: 'parse' });
  });

  it('maps 401 to auth, 429 to rate_limit and 404 no-content to http errors', async () => {
    const mk = (status: number) => createDeepSeekFetchProvider({
      apiKey: 'sk-x',
      fetchFn: async () => new Response('err', { status }),
    });
    await expect(mk(401).fetch({ url: 'https://e.com', maxChars: 10 })).rejects.toMatchObject({ kind: 'auth', status: 401 });
    await expect(mk(429).fetch({ url: 'https://e.com', maxChars: 10 })).rejects.toMatchObject({ kind: 'rate_limit', status: 429 });
    await expect(mk(404).fetch({ url: 'https://e.com', maxChars: 10 })).rejects.toMatchObject({ kind: 'http', status: 404 });
    await expect(() => createDeepSeekFetchProvider({ apiKey: '', fetchFn: async () => new Response('', { status: 200 }) }))
      .toThrow(FetchProviderError);
  });

  it('maps 403 to http with the security-policy message, not auth', async () => {
    // 官方 guides/search #errors：403 = Fetch 请求被安全策略拒绝，不是凭证故障。
    const provider = createDeepSeekFetchProvider({ apiKey: 'sk-x', fetchFn: async () => new Response('forbidden', { status: 403 }) });
    const error = await provider.fetch({ url: 'https://e.com', maxChars: 10 }).catch((e: unknown) => e as FetchProviderError);
    expect(error).toBeInstanceOf(FetchProviderError);
    expect(error).toMatchObject({ kind: 'http', status: 403 });
    expect(error.message).toContain('security policy');
  });

  it('rejects malformed keys at construction with a fixed message that never echoes the key', async () => {
    const canary = 'sk-CANARYFETCH\nheader-copy';
    const fetchFn = vi.fn(async () => new Response('', { status: 200 }));
    expect(() => createDeepSeekFetchProvider({ apiKey: canary, fetchFn })).toThrow(FetchProviderError);
    try {
      createDeepSeekFetchProvider({ apiKey: canary, fetchFn });
      expect.unreachable('construction must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FetchProviderError);
      expect((error as Error).message).toBe('invalid deepseek api key format');
      expect((error as Error).message).not.toContain('CANARYFETCH');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
