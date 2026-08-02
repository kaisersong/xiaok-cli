/**
 * MCP Transport Client Implementations
 *
 * 支持 stdio/sse/http/ws 四种 transport
 * 使用 @modelcontextprotocol/client v2 提供的 transport classes
 */
import { Client, type ClientOptions, type ProtocolEra } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { McpServerConfig, McpProtocolPolicy } from './types.js';
export declare class InPlaceStdioClientTransport extends StdioClientTransport {
}
export interface McpClientConnectionOptions {
    cwd?: string;
    clientName?: string;
}
/**
 * MCP Client Connection
 */
export interface McpClientConnection {
    client: Client;
    protocolEra: ProtocolEra;
    getStderrTail(): string;
    /** stdio child pid captured at connect time, null for network transports. */
    getChildPid(): number | null;
    /** Awaits client shutdown and, for stdio servers, full child process exit. */
    close(): Promise<void>;
    dispose(): void;
}
export type McpConnectionResult = {
    status: 'connected';
    connection: McpClientConnection;
} | {
    status: 'disabled';
    serverName: string;
    error: Error;
};
export declare const DEFAULT_MCP_STARTUP_TIMEOUT_MS = 3000;
export declare const DEFAULT_MCP_CATALOG_TIMEOUT_MS = 10000;
export declare const DEFAULT_MCP_CALL_TIMEOUT_MS = 120000;
export declare const DEFAULT_MCP_RESOURCE_TIMEOUT_MS = 30000;
export declare function resolveMcpStartupTimeoutMs(env?: NodeJS.ProcessEnv): number;
export declare function resolveMcpCatalogTimeoutMs(env?: NodeJS.ProcessEnv): number;
export declare function resolveMcpCallToolTimeoutMs(env?: NodeJS.ProcessEnv): number;
export declare function resolveMcpResourceTimeoutMs(env?: NodeJS.ProcessEnv): number;
export declare function resolveMcpClientVersion(): string;
export declare function createMcpClientOptions(probeTimeoutMs?: number, protocol?: McpProtocolPolicy): ClientOptions;
export declare function createMcpSdkClient(probeTimeoutMs?: number, protocol?: McpProtocolPolicy, clientName?: string): Client;
export declare function resolveStdioCommand(command: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): string;
/**
 * 创建 MCP client 连接（统一入口）
 */
export declare function createMcpClientConnection(serverName: string, config: McpServerConfig, options?: McpClientConnectionOptions): Promise<McpClientConnection>;
type KillProcess = (pid: number, signal?: NodeJS.Signals | 0) => boolean;
export declare function waitForProcessExit(pid: number, timeoutMs?: number, killProcess?: KillProcess): Promise<void>;
export declare function getMcpConnectionStderrTail(error: unknown): string;
export declare function tryConnect(serverName: string, config: McpServerConfig): Promise<McpConnectionResult>;
export {};
