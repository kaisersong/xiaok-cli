import { types as nodeUtilTypes } from 'node:util';

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

export function normalizeMcpToolSchema(
  server: string,
  schema: McpToolSchema,
): ToolDefinition {
  const name = prefixMcpToolName(server, schema.name);
  const inputSchema = schema.inputSchema;
  if (nodeUtilTypes.isProxy(inputSchema)) {
    throw new TypeError(
      `MCP tool ${name} input schema Proxy roots are not supported`,
    );
  }

  const clonedInputSchema: Record<string, unknown> = {};
  for (const key in inputSchema) {
    if (!Object.prototype.hasOwnProperty.call(inputSchema, key)) continue;
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
