import type { Tool } from '../../../types.js';
import { type McpToolSchema } from '../client.js';
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
    connect(declaration: McpRuntimeServerDeclaration): Promise<McpRuntimeConnectedClient>;
}
export declare function buildMcpRuntimeTools(declaration: McpRuntimeServerDeclaration, client: McpRuntimeConnectedClient, schemas: McpToolSchema[]): Tool[];
export declare function createMcpRuntimeTools(declarations: McpRuntimeServerDeclaration[], options: McpRuntimeToolFactoryOptions): Promise<Tool[]>;
