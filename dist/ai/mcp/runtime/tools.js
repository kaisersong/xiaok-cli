import { normalizeMcpToolSchema } from '../client.js';
const CUA_READ_ONLY_TOOLS = new Set([
    'get_window_state',
    'list_apps',
    'list_windows',
]);
export function resolveDefaultMcpToolPermission(serverName, toolName) {
    if (serverName === 'cua-driver') {
        return CUA_READ_ONLY_TOOLS.has(toolName) ? 'safe' : 'write';
    }
    return 'safe';
}
export function buildMcpRuntimeTools(declaration, client, schemas, options = {}) {
    return schemas.map((schema) => ({
        permission: (options.resolvePermission ?? resolveDefaultMcpToolPermission)(declaration.name, schema.name),
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
        tools.push(...buildMcpRuntimeTools(declaration, client, schemas, {
            resolvePermission: options.resolvePermission,
        }));
    }
    return tools;
}
