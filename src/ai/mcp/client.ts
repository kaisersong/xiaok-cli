import type { ToolDefinition } from '../../types.js';

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export function prefixMcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

export function normalizeMcpToolSchema(server: string, schema: McpToolSchema): ToolDefinition {
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
