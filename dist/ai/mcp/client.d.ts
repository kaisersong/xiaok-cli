import type { ToolDefinition } from '../../types.js';
export interface McpToolSchema {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown> & {
        type: 'object';
    };
}
export declare function prefixMcpToolName(server: string, tool: string): string;
export declare function normalizeMcpToolSchema(server: string, schema: McpToolSchema): ToolDefinition;
