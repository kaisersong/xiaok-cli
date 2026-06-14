import { type FetchProvider } from './types.js';
export interface BasicFetchOptions {
    fetchFn?: typeof fetch;
}
export declare function createBasicFetchProvider(options?: BasicFetchOptions): FetchProvider;
