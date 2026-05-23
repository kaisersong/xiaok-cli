import { FetchProviderError, type FetchProvider, type FetchResult, type FetchRunInput } from './types.js';

// Jina Reader (https://jina.ai/reader/). Endpoint pattern:
//   GET https://r.jina.ai/<URL>
// Returns clean markdown. API key is optional — adds higher rate limits.

export interface JinaFetchOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
  endpoint?: string;
}

export function createJinaFetchProvider(options: JinaFetchOptions = {}): FetchProvider {
  const endpoint = options.endpoint ?? 'https://r.jina.ai';
  const fetchFn = options.fetchFn ?? fetch;
  return {
    name: 'web_fetch.jina',
    displayName: 'Jina Reader',
    async fetch(input: FetchRunInput): Promise<FetchResult> {
      // Jina expects the encoded target URL appended directly to the endpoint.
      // Keep slashes (jina is permissive); we do not URL-encode the whole URL
      // because that breaks their routing.
      const targetUrl = `${endpoint.replace(/\/$/, '')}/${input.url}`;
      const headers: Record<string, string> = {
        accept: 'text/plain, text/markdown, */*',
      };
      if (options.apiKey) {
        headers.authorization = `Bearer ${options.apiKey}`;
      }
      let response: Response;
      try {
        response = await fetchFn(targetUrl, { method: 'GET', headers, signal: input.signal });
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
      const contentType = response.headers.get('content-type') ?? 'text/markdown';
      const body = await response.text();
      return {
        url: input.url,
        contentType,
        content: body.trim(),
        source: 'web_fetch.jina',
      };
    },
  };
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
