import type { Tool, ToolDefinition } from '../../types.js';
export interface DeferredToolSearch {
    searchTools(query: string): ToolDefinition[];
    searchDeferredTools(query: string): ToolDefinition[];
}
export declare function createToolSearchTool(registry: DeferredToolSearch): Tool;
