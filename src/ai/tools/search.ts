import type {ToolDiscovery} from '../../shared/tool-description-metadata.js';
import type { Tool, ToolDefinition } from '../../types.js';

export interface DeferredToolSearch {
  searchTools(query: string): ToolDefinition[];
  searchToolDiscoveries?(query:string):ToolDiscovery[];
  searchDeferredTools(query: string): ToolDefinition[];
}

export function createToolSearchTool(registry: DeferredToolSearch): Tool {
  return {
    permission: 'safe',
    definition: {
      name: 'tool_search',
      description: '搜索当前可用 tools 与 deferred tools，并返回对应 schema',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索词或 select:name1,name2' },
        },
        required: ['query'],
      },
    },
    async execute(input) {
      const query = typeof input.query === 'string' ? input.query : '';
      const tools = registry.searchToolDiscoveries ? registry.searchToolDiscoveries(query).map(({coreDefinition,metadata})=>metadata?{...coreDefinition,...metadata}:coreDefinition) : registry.searchTools(query);
      return JSON.stringify(tools, null, 2);
    },
  };
}
