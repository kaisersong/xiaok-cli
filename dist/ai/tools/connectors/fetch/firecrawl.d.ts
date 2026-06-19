import { type FetchProvider } from './types.js';
export interface FirecrawlFetchOptions {
    apiKey?: string;
    fetchFn?: typeof fetch;
    endpoint?: string;
}
export declare function createFirecrawlFetchProvider(options?: FirecrawlFetchOptions): FetchProvider;
