import { type SearchProvider } from './types.js';
export interface BraveOptions {
    apiKey: string;
    fetchFn?: typeof fetch;
    endpoint?: string;
}
export declare function createBraveSearchProvider(options: BraveOptions): SearchProvider;
