import type { Tool } from '../../types.js';
import type { McpInvocationOptions, McpRuntimeToolResult } from '../mcp/runtime/client.js';
import { type CuaAbiProfile } from '../../platform/computer-use/cua-action-contract.js';
export interface ComputerUseBackend {
    abiProfile?: CuaAbiProfile;
    requiresImageInput?: boolean;
    prepareActionInput?(action: string, input: Record<string, unknown>): Record<string, unknown>;
    acquireInvocation?(): {
        generation: number;
        backend: ComputerUseBackend;
        isCurrent(): boolean;
    } | null;
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
    waitForUserAction?: boolean;
    retryable?: boolean;
    notifyBackend?: boolean;
    remember?: boolean;
    nextAction?: string;
}
export declare function createComputerUseTool(backend: ComputerUseBackend, abiProfile?: CuaAbiProfile): Tool;
