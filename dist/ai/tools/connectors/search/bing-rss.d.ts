import { type SearchProvider } from './types.js';
/** Independent public RSS transport used when the default HTML search is unavailable. */
export declare function createBingRssSearchProvider(options?: {
    fetchFn?: typeof fetch;
}): SearchProvider;
