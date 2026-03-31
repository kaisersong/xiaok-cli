import type { Tool } from '../../../types.js';
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
}

export function buildMcpRuntimeTools(
  declaration: McpRuntimeServerDeclaration,
  client: McpRuntimeConnectedClient,
  schemas: McpToolSchema[],
): Tool[] {
  return schemas.map((schema) => ({
    permission: 'safe',
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
    tools.push(...buildMcpRuntimeTools(declaration, client, schemas));
  }

  return tools;
}
