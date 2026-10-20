import { type SearchProvider } from './types.js';
export interface DeepSeekSearchOptions {
    apiKey: string;
    fetchFn?: typeof fetch;
    endpoint?: string;
}
export declare function createDeepSeekSearchProvider(options: DeepSeekSearchOptions): SearchProvider;
