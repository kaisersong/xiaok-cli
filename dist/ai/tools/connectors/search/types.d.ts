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
export type SearchProviderName = 'web_search.duckduckgo' | 'web_search.tavily' | 'web_search.brave';
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
export declare class SearchProviderError extends Error {
    readonly kind: 'http' | 'network' | 'parse' | 'auth' | 'rate_limit';
    readonly status?: number;
    constructor(message: string, opts: {
        kind: SearchProviderError['kind'];
        status?: number;
    });
}
