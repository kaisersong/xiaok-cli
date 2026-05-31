/**
 * MCP Transport Client Implementations
 *
 * 支持 stdio/sse/http/ws 四种 transport
 * 使用 @modelcontextprotocol/sdk 提供的 transport classes
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServerConfig } from './types.js';
/**
 * MCP Client Connection
 */
export interface McpClientConnection {
    client: Client;
    dispose(): void;
}
export declare const DEFAULT_MCP_STARTUP_TIMEOUT_MS = 3000;
export declare function resolveMcpStartupTimeoutMs(env?: NodeJS.ProcessEnv): number;
export declare function resolveStdioCommand(command: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): string;
/**
 * 创建 MCP client 连接（统一入口）
 */
export declare function createMcpClientConnection(serverName: string, config: McpServerConfig): Promise<McpClientConnection>;
