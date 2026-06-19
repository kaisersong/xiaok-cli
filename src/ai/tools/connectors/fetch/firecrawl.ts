import { FetchProviderError, type FetchProvider, type FetchResult, type FetchRunInput } from './types.js';

export interface FirecrawlFetchOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
  endpoint?: string;
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    markdown?: unknown;
    metadata?: {
      url?: unknown;
      contentType?: unknown;
    };
  };
  error?: string;
}

export function createFirecrawlFetchProvider(options: FirecrawlFetchOptions = {}): FetchProvider {
  const endpoint = options.endpoint ?? 'https://api.firecrawl.dev/v2/scrape';
  const fetchFn = options.fetchFn ?? fetch;

  return {
    name: 'web_fetch.firecrawl',
    displayName: 'Firecrawl',
    async fetch(input: FetchRunInput): Promise<FetchResult> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json',
      };
      if (options.apiKey) {
        headers.authorization = `Bearer ${options.apiKey}`;
      }

      const body = JSON.stringify({
        url: input.url,
        formats: ['markdown'],
      });

      let response: Response;
      try {
        response = await fetchFn(endpoint, {
          method: 'POST',
          headers,
          body,
          signal: input.signal,
        });
      } catch (error) {
        throw new FetchProviderError(toMessage(error), { kind: 'network' });
      }

      if (response.status === 401 || response.status === 403) {
        throw new FetchProviderError(`${response.status} unauthorized`, {
          kind: 'auth',
          status: response.status,
        });
      }
      if (response.status === 429) {
        throw new FetchProviderError('429 rate limited', { kind: 'rate_limit', status: 429 });
      }
      if (!response.ok) {
        throw new FetchProviderError(`${response.status} ${response.statusText}`.trim(), {
          kind: 'http',
          status: response.status,
        });
      }

      let parsed: FirecrawlScrapeResponse;
      try {
        parsed = (await response.json()) as FirecrawlScrapeResponse;
      } catch (error) {
        throw new FetchProviderError(`invalid json: ${toMessage(error)}`, { kind: 'parse' });
      }

      const markdown = typeof parsed.data?.markdown === 'string' ? parsed.data.markdown : '';
      const contentType = typeof parsed.data?.metadata?.contentType === 'string'
        ? parsed.data.metadata.contentType
        : 'text/markdown';
      const resolvedUrl = typeof parsed.data?.metadata?.url === 'string'
        ? parsed.data.metadata.url
        : input.url;

      const content = input.maxChars > 0 ? markdown.slice(0, input.maxChars) : markdown;

      return {
        url: resolvedUrl,
        contentType,
        content,
        source: 'web_fetch.firecrawl',
      };
    },
  };
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
