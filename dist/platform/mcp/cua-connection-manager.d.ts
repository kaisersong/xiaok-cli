import type { McpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';
export interface CuaConnection {
    callToolResult(name: string, input: Record<string, unknown>): Promise<McpRuntimeToolResult>;
    dispose(): void;
}
export type CuaConnectionFactory = () => Promise<CuaConnection>;
export type CuaConnectionState = 'idle' | 'connecting' | 'connected' | 'closing' | 'failed';
export interface CuaConnectionManagerOptions {
    connectTimeoutMs?: number;
}
export declare class CuaConnectionManager {
    private _state;
    private _connection;
    private _connectPromise;
    private _cancelled;
    private readonly _factory;
    private readonly _connectTimeoutMs;
    constructor(factory: CuaConnectionFactory, options?: CuaConnectionManagerOptions);
    get state(): CuaConnectionState;
    callToolResult(name: string, input: Record<string, unknown>): Promise<McpRuntimeToolResult>;
    dispose(): Promise<void>;
    private _cleanup;
    private _ensureConnected;
    private _doConnect;
}
