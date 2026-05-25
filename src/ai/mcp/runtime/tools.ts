import type { Tool } from '../../../types.js';
import type { PermissionClass } from '../../../types.js';
import { normalizeMcpToolSchema, type McpToolSchema } from '../client.js';

export interface McpRuntimeServerDeclaration {
  name: string;
  command: string;
}

export interface McpRuntimeConnectedClient {
  listTools(): Promise<McpToolSchema[]>;
  callTool(name: string, input: Record<string, unknown>): Promise<string>;
  dispose(): void;
}

export interface McpRuntimeToolFactoryOptions {
  connect(
    declaration: McpRuntimeServerDeclaration,
  ): Promise<McpRuntimeConnectedClient>;
  resolvePermission?(serverName: string, toolName: string): PermissionClass;
}

export interface McpRuntimeToolBuildOptions {
  resolvePermission?(serverName: string, toolName: string): PermissionClass;
}

const CUA_READ_ONLY_TOOLS = new Set([
  'get_app_state',
  'list_apps',
]);

export function resolveDefaultMcpToolPermission(serverName: string, toolName: string): PermissionClass {
  if (serverName === 'cua-driver') {
    return CUA_READ_ONLY_TOOLS.has(toolName) ? 'safe' : 'write';
  }
  return 'safe';
}

export function buildMcpRuntimeTools(
  declaration: McpRuntimeServerDeclaration,
  client: McpRuntimeConnectedClient,
  schemas: McpToolSchema[],
  options: McpRuntimeToolBuildOptions = {},
): Tool[] {
  return schemas.map((schema) => ({
    permission: (options.resolvePermission ?? resolveDefaultMcpToolPermission)(declaration.name, schema.name),
    definition: normalizeMcpToolSchema(declaration.name, schema),
    async execute(input) {
      return client.callTool(schema.name, input);
    },
  }));
}

export async function createMcpRuntimeTools(
  declarations: McpRuntimeServerDeclaration[],
  options: McpRuntimeToolFactoryOptions,
): Promise<Tool[]> {
  const tools: Tool[] = [];

  for (const declaration of declarations) {
    const client = await options.connect(declaration);
    const schemas = await client.listTools();
    tools.push(...buildMcpRuntimeTools(declaration, client, schemas, {
      resolvePermission: options.resolvePermission,
    }));
  }

  return tools;
}
