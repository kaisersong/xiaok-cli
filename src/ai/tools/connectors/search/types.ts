// Shared interface for all web_search providers.
// Providers are pure transports: they take a query, return normalized SearchHit[].
// Provider construction validates config; selection / fallback / wiring lives in the registry.

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  score?: number;
}

export interface SearchRunInput {
  query: string;
  count: number;
  signal?: AbortSignal;
}

export type SearchProviderName =
  | 'web_search.duckduckgo'
  | 'web_search.tavily'
  | 'web_search.brave'
  | 'web_search.firecrawl';

export interface SearchProvider {
  readonly name: SearchProviderName;
  readonly displayName: string;
  search(input: SearchRunInput): Promise<SearchHit[]>;
}

/**
 * Thrown by a provider when the upstream call fails in a way the registry can
 * surface verbatim to the user (HTTP error, network error, malformed body).
 * Carrying both kind and message lets the registry attach a short, redacted
 * tag to the tool output instead of dumping HTML or a raw stack.
 */
export class SearchProviderError extends Error {
  readonly kind: 'http' | 'network' | 'parse' | 'auth' | 'rate_limit';
  readonly status?: number;
  constructor(message: string, opts: { kind: SearchProviderError['kind']; status?: number }) {
    super(message);
    this.name = 'SearchProviderError';
    this.kind = opts.kind;
    this.status = opts.status;
  }
}
