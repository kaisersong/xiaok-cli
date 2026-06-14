import { type SearchProvider } from './types.js';
export interface DuckDuckGoOptions {
    fetchFn?: typeof fetch;
}
export declare function createDuckDuckGoSearchProvider(options?: DuckDuckGoOptions): SearchProvider;
