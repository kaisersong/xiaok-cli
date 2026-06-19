// Shared interface for all web_fetch providers.
// Providers return text that is already model-friendly (markdown or plain).

export interface FetchResult {
  url: string;
  contentType: string;
  content: string;
  source: FetchProviderName;
}

export interface FetchRunInput {
  url: string;
  maxChars: number;
  signal?: AbortSignal;
}

export type FetchProviderName = 'web_fetch.basic' | 'web_fetch.jina' | 'web_fetch.firecrawl';

export interface FetchProvider {
  readonly name: FetchProviderName;
  readonly displayName: string;
  fetch(input: FetchRunInput): Promise<FetchResult>;
}

export class FetchProviderError extends Error {
  readonly kind: 'http' | 'network' | 'parse' | 'auth' | 'rate_limit';
  readonly status?: number;
  constructor(message: string, opts: { kind: FetchProviderError['kind']; status?: number }) {
    super(message);
    this.name = 'FetchProviderError';
    this.kind = opts.kind;
    this.status = opts.status;
  }
}
