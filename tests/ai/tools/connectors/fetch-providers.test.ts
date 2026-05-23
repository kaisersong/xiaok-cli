import { describe, expect, it, vi } from 'vitest';
import { createJinaFetchProvider } from '../../../../src/ai/tools/connectors/fetch/jina.js';
import { FetchProviderError } from '../../../../src/ai/tools/connectors/fetch/types.js';

describe('jina fetch provider', () => {
  it('returns markdown content with no api key', async () => {
    const fetchFn = vi.fn(async () => new Response('# Hello\nworld', {
      status: 200,
      headers: { 'content-type': 'text/markdown' },
    }));
    const provider = createJinaFetchProvider({ fetchFn });
    const result = await provider.fetch({ url: 'https://example.com/page', maxChars: 1000 });
    expect(result.source).toBe('web_fetch.jina');
    expect(result.content).toContain('# Hello');
    const calledUrl = String(fetchFn.mock.calls[0][0]);
    expect(calledUrl).toBe('https://r.jina.ai/https://example.com/page');
    const init = fetchFn.mock.calls[0][1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBeUndefined();
  });

  it('attaches Bearer when api key is provided', async () => {
    const fetchFn = vi.fn(async () => new Response('content', { status: 200 }));
    const provider = createJinaFetchProvider({ apiKey: 'jina-key', fetchFn });
    await provider.fetch({ url: 'https://example.com/', maxChars: 1000 });
    const init = fetchFn.mock.calls[0][1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe('Bearer jina-key');
  });

  it('maps 401 to auth error', async () => {
    const provider = createJinaFetchProvider({
      apiKey: 'k',
      fetchFn: async () => new Response('nope', { status: 401 }),
    });
    await expect(provider.fetch({ url: 'https://example.com/', maxChars: 1000 }))
      .rejects.toBeInstanceOf(FetchProviderError);
  });
});
