import type { Tool, ToolDefinition } from '../../types.js';
export interface DeferredToolSearch {
    searchDeferredTools(query: string): ToolDefinition[];
}
export declare function createToolSearchTool(registry: DeferredToolSearch): Tool;
