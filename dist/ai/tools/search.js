export function createToolSearchTool(registry) {
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
            const tools = registry.searchTools(query);
            return JSON.stringify(tools, null, 2);
        },
    };
}
