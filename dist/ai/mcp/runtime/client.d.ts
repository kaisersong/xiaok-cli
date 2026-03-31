import type { McpToolSchema } from '../client.js';
export interface McpRuntimeRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, unknown>;
}
export interface McpRuntimeResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: {
        message: string;
    };
}
export interface McpRuntimeTransport {
    send(message: McpRuntimeRequest): Promise<McpRuntimeResponse>;
}
export declare function createMcpRuntimeClient(transport: McpRuntimeTransport): {
    initialize(): Promise<unknown>;
    listTools(): Promise<McpToolSchema[]>;
    callTool(name: string, input: Record<string, unknown>): Promise<string>;
};
