import { SearchProviderError, type SearchHit, type SearchProvider, type SearchRunInput } from './types.js';

// Brave Search API (https://api.search.brave.com/app/documentation/web-search/get-started)
// Uses X-Subscription-Token header; we cap count to 10 (also enforced upstream by Brave).

export interface BraveOptions {
  apiKey: string;
  fetchFn?: typeof fetch;
  endpoint?: string;
}

interface BraveRawResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  page_age?: unknown;
}

interface BraveResponseBody {
  web?: { results?: unknown };
}

export function createBraveSearchProvider(options: BraveOptions): SearchProvider {
  if (!options.apiKey) {
    throw new SearchProviderError('missing brave api key', { kind: 'auth' });
  }
  const endpoint = options.endpoint ?? 'https://api.search.brave.com/res/v1/web/search';
  const fetchFn = options.fetchFn ?? fetch;

  return {
    name: 'web_search.brave',
    displayName: 'Brave',
    async search(input: SearchRunInput): Promise<SearchHit[]> {
      const params = new URLSearchParams({
        q: input.query,
        count: String(Math.max(1, Math.min(10, input.count))),
      });
      let response: Response;
      try {
        response = await fetchFn(`${endpoint}?${params.toString()}`, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'X-Subscription-Token': options.apiKey,
          },
          signal: input.signal,
        });
      } catch (error) {
        throw new SearchProviderError(toMessage(error), { kind: 'network' });
      }
      if (response.status === 401 || response.status === 403) {
        throw new SearchProviderError(`${response.status} unauthorized`, {
          kind: 'auth',
          status: response.status,
        });
      }
      if (response.status === 429) {
        throw new SearchProviderError('429 rate limited', { kind: 'rate_limit', status: 429 });
      }
      if (!response.ok) {
        throw new SearchProviderError(`${response.status} ${response.statusText}`.trim(), {
          kind: 'http',
          status: response.status,
        });
      }

      let parsed: BraveResponseBody;
      try {
        parsed = (await response.json()) as BraveResponseBody;
      } catch (error) {
        throw new SearchProviderError(`invalid json: ${toMessage(error)}`, { kind: 'parse' });
      }

      const rawResults: BraveRawResult[] = Array.isArray(parsed.web?.results)
        ? (parsed.web!.results as BraveRawResult[])
        : [];

      const hits: SearchHit[] = [];
      for (const item of rawResults.slice(0, Math.max(1, input.count))) {
        const url = typeof item.url === 'string' ? item.url : '';
        if (!url) continue;
        hits.push({
          title: typeof item.title === 'string' ? item.title : url,
          url,
          snippet: pickString(item.description) ?? '',
          publishedAt: pickString(item.page_age),
        });
      }
      return hits;
    },
  };
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
