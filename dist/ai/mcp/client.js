export function prefixMcpToolName(server, tool) {
    return `mcp__${server}__${tool}`;
}
export function normalizeMcpToolSchema(server, schema) {
    return {
        name: prefixMcpToolName(server, schema.name),
        description: schema.description ?? '',
        inputSchema: {
            type: 'object',
            properties: schema.inputSchema.properties ?? {},
            required: schema.inputSchema.required ?? [],
        },
    };
}
