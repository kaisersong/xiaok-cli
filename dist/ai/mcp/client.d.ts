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
export declare function prefixMcpToolName(server: string, tool: string): string;
export declare function normalizeMcpToolSchema(server: string, schema: McpToolSchema): ToolDefinition;
