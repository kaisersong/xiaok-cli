import type { Tool } from '../../../types.js';
import type { PermissionClass } from '../../../types.js';
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
    resolvePermission?(serverName: string, toolName: string): PermissionClass;
}
export interface McpRuntimeToolBuildOptions {
    resolvePermission?(serverName: string, toolName: string): PermissionClass;
}
export declare function resolveDefaultMcpToolPermission(serverName: string, toolName: string): PermissionClass;
export declare function buildMcpRuntimeTools(declaration: McpRuntimeServerDeclaration, client: McpRuntimeConnectedClient, schemas: McpToolSchema[], options?: McpRuntimeToolBuildOptions): Tool[];
export declare function createMcpRuntimeTools(declarations: McpRuntimeServerDeclaration[], options: McpRuntimeToolFactoryOptions): Promise<Tool[]>;
