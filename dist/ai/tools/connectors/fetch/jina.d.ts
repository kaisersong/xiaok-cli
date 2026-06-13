import { type FetchProvider } from './types.js';
export interface JinaFetchOptions {
    apiKey?: string;
    fetchFn?: typeof fetch;
    endpoint?: string;
}
export declare function createJinaFetchProvider(options?: JinaFetchOptions): FetchProvider;
