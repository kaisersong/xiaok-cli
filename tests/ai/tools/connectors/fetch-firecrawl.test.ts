import { describe, expect, it } from 'vitest';
import { createFirecrawlFetchProvider } from '../../../../src/ai/tools/connectors/fetch/firecrawl.js';
import { FetchProviderError } from '../../../../src/ai/tools/connectors/fetch/types.js';

function mockFetch(status: number, body: unknown) {
  const fn = async (_url: any, init: any) => {
    fn.lastInit = init;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  fn.lastInit = undefined as any;
  return fn as unknown as typeof fetch & { lastInit: any };
}

describe('Firecrawl fetch provider', () => {
  it('returns markdown content from a successful keyless scrape', async () => {
    const fetchFn = mockFetch(200, {
      success: true,
      data: {
        markdown: '# Hello\n\nWorld',
        metadata: { url: 'https://example.com/', contentType: 'text/html', statusCode: 200 },
      },
    });
    const provider = createFirecrawlFetchProvider({ fetchFn });
    const result = await provider.fetch({ url: 'https://example.com', maxChars: 10000 });
    expect(result.content).toBe('# Hello\n\nWorld');
    expect(result.url).toBe('https://example.com/');
    expect(result.source).toBe('web_fetch.firecrawl');
    expect(fetchFn.lastInit.headers.authorization).toBeUndefined();
  });

  it('includes Authorization header when apiKey is provided', async () => {
    const fetchFn = mockFetch(200, { success: true, data: { markdown: 'ok', metadata: {} } });
    const provider = createFirecrawlFetchProvider({ apiKey: 'fc-key', fetchFn });
    await provider.fetch({ url: 'https://x.com', maxChars: 100 });
    expect(fetchFn.lastInit.headers.authorization).toBe('Bearer fc-key');
  });

  it('truncates content to maxChars', async () => {
    const fetchFn = mockFetch(200, {
      success: true,
      data: { markdown: 'A'.repeat(500), metadata: {} },
    });
    const provider = createFirecrawlFetchProvider({ fetchFn });
    const result = await provider.fetch({ url: 'https://example.com', maxChars: 100 });
    expect(result.content).toHaveLength(100);
  });

  it('throws auth error on 401', async () => {
    const fetchFn = mockFetch(401, { error: 'Unauthorized' });
    const provider = createFirecrawlFetchProvider({ fetchFn });
    try {
      await provider.fetch({ url: 'https://x.com', maxChars: 100 });
    } catch (e) {
      expect(e).toBeInstanceOf(FetchProviderError);
      expect((e as FetchProviderError).kind).toBe('auth');
    }
  });

  it('throws rate_limit error on 429', async () => {
    const fetchFn = mockFetch(429, {});
    const provider = createFirecrawlFetchProvider({ fetchFn });
    try {
      await provider.fetch({ url: 'https://x.com', maxChars: 100 });
    } catch (e) {
      expect((e as FetchProviderError).kind).toBe('rate_limit');
    }
  });

  it('throws network error on fetch failure', async () => {
    const fetchFn = async () => { throw new Error('timeout'); };
    const provider = createFirecrawlFetchProvider({ fetchFn: fetchFn as any });
    try {
      await provider.fetch({ url: 'https://x.com', maxChars: 100 });
    } catch (e) {
      expect((e as FetchProviderError).kind).toBe('network');
    }
  });
});
