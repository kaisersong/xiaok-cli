import { type SearchProvider } from './types.js';
export interface TavilyOptions {
    apiKey: string;
    fetchFn?: typeof fetch;
    endpoint?: string;
}
export declare function createTavilySearchProvider(options: TavilyOptions): SearchProvider;
