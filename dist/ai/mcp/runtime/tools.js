import { normalizeMcpToolSchema } from '../client.js';
export function buildMcpRuntimeTools(declaration, client, schemas) {
    return schemas.map((schema) => ({
        permission: 'safe',
        definition: normalizeMcpToolSchema(declaration.name, schema),
        async execute(input) {
            return client.callTool(schema.name, input);
        },
    }));
}
export async function createMcpRuntimeTools(declarations, options) {
    const tools = [];
    for (const declaration of declarations) {
        const client = await options.connect(declaration);
        const schemas = await client.listTools();
        tools.push(...buildMcpRuntimeTools(declaration, client, schemas));
    }
    return tools;
}
