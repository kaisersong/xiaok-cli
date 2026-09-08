import type { Tool } from '../../types.js';
import type { McpInvocationOptions, McpRuntimeToolResult } from '../mcp/runtime/client.js';
export interface ComputerUseBackend {
    getUnavailableError?(): ComputerUseUnavailableError | null;
    onRecoverableError?(error: ComputerUseUnavailableError): void;
    callToolResult(name: string, input: Record<string, unknown>, options?: McpInvocationOptions): Promise<McpRuntimeToolResult>;
}
export interface ComputerUseUnavailableError {
    code: string;
    message: string;
    userAction?: {
        type: string;
        label: string;
    };
}
export declare function createComputerUseTool(backend: ComputerUseBackend): Tool;
