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
export declare class FetchProviderError extends Error {
    readonly kind: 'http' | 'network' | 'parse' | 'auth' | 'rate_limit';
    readonly status?: number;
    constructor(message: string, opts: {
        kind: FetchProviderError['kind'];
        status?: number;
    });
}
