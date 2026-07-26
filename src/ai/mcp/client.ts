import type { ToolDefinition } from '../../types.js';

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown> & {
    type: 'object';
  };
}

export function prefixMcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

export function normalizeMcpToolSchema(server: string, schema: McpToolSchema): ToolDefinition {
  return {
    name: prefixMcpToolName(server, schema.name),
    description: schema.description ?? '',
    inputSchema: { ...schema.inputSchema },
  };
}
