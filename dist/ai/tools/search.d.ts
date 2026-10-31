import type { ToolDiscovery } from '../../shared/tool-description-metadata.js';
import type { Tool, ToolDefinition } from '../../types.js';
export interface DeferredToolSearch {
    searchTools(query: string): ToolDefinition[];
    searchToolDiscoveries?(query: string): ToolDiscovery[];
    searchDeferredTools(query: string): ToolDefinition[];
}
export declare function createToolSearchTool(registry: DeferredToolSearch): Tool;
