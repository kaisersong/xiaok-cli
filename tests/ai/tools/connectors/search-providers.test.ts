import { describe, expect, it, vi } from 'vitest';
import { createTavilySearchProvider } from '../../../../src/ai/tools/connectors/search/tavily.js';
import { createBraveSearchProvider } from '../../../../src/ai/tools/connectors/search/brave.js';
import { SearchProviderError } from '../../../../src/ai/tools/connectors/search/types.js';

describe('tavily search provider', () => {
  it('parses tavily JSON results into SearchHit shape', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { title: 'Hello', url: 'https://example.com/a', content: 'snippet a', score: 0.9 },
        { title: 'World', url: 'https://example.com/b', content: 'snippet b', published_date: '2026-05-01' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = createTavilySearchProvider({ apiKey: 'tvly-x', fetchFn });
    const hits = await provider.search({ query: 'q', count: 5 });
    expect(hits.length).toBe(2);
    expect(hits[0].url).toBe('https://example.com/a');
    expect(hits[0].score).toBe(0.9);
    expect(hits[1].publishedAt).toBe('2026-05-01');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('throws auth error for 401', async () => {
    const provider = createTavilySearchProvider({
      apiKey: 'tvly-x',
      fetchFn: async () => new Response('nope', { status: 401 }),
    });
    await expect(provider.search({ query: 'q', count: 5 })).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
    });
  });

  it('throws rate_limit error for 429', async () => {
    const provider = createTavilySearchProvider({
      apiKey: 'tvly-x',
      fetchFn: async () => new Response('slow down', { status: 429 }),
    });
    await expect(provider.search({ query: 'q', count: 5 })).rejects.toMatchObject({
      kind: 'rate_limit',
    });
  });

  it('rejects without api key', () => {
    expect(() => createTavilySearchProvider({ apiKey: '', fetchFn: async () => new Response() }))
      .toThrow(SearchProviderError);
  });
});

describe('brave search provider', () => {
  it('reads results from web.results', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      web: {
        results: [
          { title: 'Brave hit', url: 'https://example.com/x', description: 'desc', page_age: '2026-04-01' },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = createBraveSearchProvider({ apiKey: 'brave-x', fetchFn });
    const hits = await provider.search({ query: 'q', count: 3 });
    expect(hits.length).toBe(1);
    expect(hits[0].snippet).toBe('desc');
    expect(hits[0].publishedAt).toBe('2026-04-01');
    const callUrl = String(fetchFn.mock.calls[0][0]);
    expect(callUrl).toContain('q=');
    expect(callUrl).toContain('count=3');
  });

  it('returns empty list when web.results is missing', async () => {
    const provider = createBraveSearchProvider({
      apiKey: 'brave-x',
      fetchFn: async () => new Response(JSON.stringify({}), { status: 200 }),
    });
    const hits = await provider.search({ query: 'q', count: 5 });
    expect(hits).toEqual([]);
  });

  it('caps count at 10', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ web: { results: [] } }), { status: 200 }));
    const provider = createBraveSearchProvider({ apiKey: 'brave-x', fetchFn });
    await provider.search({ query: 'q', count: 50 });
    const callUrl = String(fetchFn.mock.calls[0][0]);
    expect(callUrl).toContain('count=10');
  });
});
