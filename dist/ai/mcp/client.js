import { types as nodeUtilTypes } from 'node:util';
export function prefixMcpToolName(server, tool) {
    return `mcp__${server}__${tool}`;
}
export function normalizeMcpToolSchema(server, schema) {
    const name = prefixMcpToolName(server, schema.name);
    const inputSchema = schema.inputSchema;
    if (nodeUtilTypes.isProxy(inputSchema)) {
        throw new TypeError(`MCP tool ${name} input schema Proxy roots are not supported`);
    }
    const clonedInputSchema = {};
    for (const key in inputSchema) {
        if (!Object.prototype.hasOwnProperty.call(inputSchema, key))
            continue;
        const descriptor = Object.getOwnPropertyDescriptor(inputSchema, key);
        if (descriptor) {
            Object.defineProperty(clonedInputSchema, key, descriptor);
        }
    }
    return {
        name,
        description: schema.description ?? '',
        inputSchema: clonedInputSchema,
    };
}
