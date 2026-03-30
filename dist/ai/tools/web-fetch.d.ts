import type { Tool } from '../../types.js';
export interface WebFetchOptions {
    fetchFn?: typeof fetch;
}
export declare function createWebFetchTool(options?: WebFetchOptions): Tool;
export declare const webFetchTool: Tool;
