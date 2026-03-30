import type { Tool } from '../../types.js';
export interface WebSearchOptions {
    fetchFn?: typeof fetch;
}
export declare function createWebSearchTool(options?: WebSearchOptions): Tool;
export declare const webSearchTool: Tool;
