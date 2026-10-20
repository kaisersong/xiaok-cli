import { type FetchProvider } from './types.js';
export interface DeepSeekFetchOptions {
    apiKey: string;
    fetchFn?: typeof fetch;
    endpoint?: string;
}
export declare function createDeepSeekFetchProvider(options: DeepSeekFetchOptions): FetchProvider;
