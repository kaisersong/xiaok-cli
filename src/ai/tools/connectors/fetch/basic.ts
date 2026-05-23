import { FetchProviderError, type FetchProvider, type FetchResult, type FetchRunInput } from './types.js';

// Basic fetch: legacy behaviour migrated from web-fetch.ts.
// Returns html-stripped plain text. No truncation here — the tool entry handles it.

export interface BasicFetchOptions {
  fetchFn?: typeof fetch;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createBasicFetchProvider(options: BasicFetchOptions = {}): FetchProvider {
  const fetchFn = options.fetchFn ?? fetch;
  return {
    name: 'web_fetch.basic',
    displayName: 'Basic',
    async fetch(input: FetchRunInput): Promise<FetchResult> {
      let response: Response;
      try {
        response = await fetchFn(input.url, { signal: input.signal });
      } catch (error) {
        throw new FetchProviderError(toMessage(error), { kind: 'network' });
      }
      if (!response.ok) {
        throw new FetchProviderError(`${response.status} ${response.statusText}`.trim(), {
          kind: 'http',
          status: response.status,
        });
      }
      const contentType = response.headers.get('content-type') ?? 'text/plain';
      const body = await response.text();
      const normalized = /html/i.test(contentType) ? stripHtml(body) : body.trim();
      return {
        url: input.url,
        contentType,
        content: normalized,
        source: 'web_fetch.basic',
      };
    },
  };
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
