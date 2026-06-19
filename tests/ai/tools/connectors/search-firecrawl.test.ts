import { describe, expect, it } from 'vitest';
import { createFirecrawlSearchProvider } from '../../../../src/ai/tools/connectors/search/firecrawl.js';
import { SearchProviderError } from '../../../../src/ai/tools/connectors/search/types.js';

function mockFetch(status: number, body: unknown) {
  const fn = async (_url: any, init: any) => {
    fn.lastInit = init;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  fn.lastInit = undefined as any;
  return fn as unknown as typeof fetch & { lastInit: any };
}

describe('Firecrawl search provider', () => {
  it('returns search hits from a successful keyless response', async () => {
    const fetchFn = mockFetch(200, {
      success: true,
      data: {
        web: [
          { url: 'https://example.com', title: 'Example', description: 'An example page', position: 1 },
          { url: 'https://test.dev', title: 'Test', description: 'Testing', position: 2 },
        ],
      },
    });
    const provider = createFirecrawlSearchProvider({ fetchFn });
    const hits = await provider.search({ query: 'test', count: 5 });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({ title: 'Example', url: 'https://example.com', snippet: 'An example page' });
    expect(fetchFn.lastInit.headers.authorization).toBeUndefined();
  });

  it('includes Authorization header when apiKey is provided', async () => {
    const fetchFn = mockFetch(200, { success: true, data: { web: [] } });
    const provider = createFirecrawlSearchProvider({ apiKey: 'fc-test', fetchFn });
    await provider.search({ query: 'q', count: 1 });
    expect(fetchFn.lastInit.headers.authorization).toBe('Bearer fc-test');
  });

  it('returns empty array for empty web results', async () => {
    const fetchFn = mockFetch(200, { success: true, data: { web: [] } });
    const provider = createFirecrawlSearchProvider({ fetchFn });
    const hits = await provider.search({ query: 'nothing', count: 5 });
    expect(hits).toEqual([]);
  });

  it('throws auth error on 401', async () => {
    const fetchFn = mockFetch(401, { error: 'Unauthorized' });
    const provider = createFirecrawlSearchProvider({ fetchFn });
    await expect(provider.search({ query: 'q', count: 1 })).rejects.toThrow(SearchProviderError);
    try {
      await provider.search({ query: 'q', count: 1 });
    } catch (e) {
      expect((e as SearchProviderError).kind).toBe('auth');
    }
  });

  it('throws rate_limit error on 429', async () => {
    const fetchFn = mockFetch(429, { error: 'rate limited' });
    const provider = createFirecrawlSearchProvider({ fetchFn });
    try {
      await provider.search({ query: 'q', count: 1 });
    } catch (e) {
      expect((e as SearchProviderError).kind).toBe('rate_limit');
    }
  });

  it('throws network error on fetch failure', async () => {
    const fetchFn = async () => { throw new Error('ECONNREFUSED'); };
    const provider = createFirecrawlSearchProvider({ fetchFn: fetchFn as any });
    try {
      await provider.search({ query: 'q', count: 1 });
    } catch (e) {
      expect((e as SearchProviderError).kind).toBe('network');
    }
  });
});
