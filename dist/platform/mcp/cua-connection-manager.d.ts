import type { McpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';
export interface CuaConnection {
    callToolResult(name: string, input: Record<string, unknown>): Promise<McpRuntimeToolResult>;
    dispose(): void;
}
export type CuaConnectionFactory = () => Promise<CuaConnection>;
export type CuaConnectionState = 'idle' | 'connecting' | 'connected' | 'closing' | 'failed';
export interface CuaConnectionManagerOptions {
    connectTimeoutMs?: number;
    initialConnection?: CuaConnection;
}
export declare class CuaConnectionManager {
    private _state;
    private _connection;
    private _connectPromise;
    private _epoch;
    private readonly _revivePromises;
    private readonly _factory;
    private readonly _connectTimeoutMs;
    constructor(factory: CuaConnectionFactory, options?: CuaConnectionManagerOptions);
    get state(): CuaConnectionState;
    callToolResult(name: string, input: Record<string, unknown>): Promise<McpRuntimeToolResult>;
    dispose(): Promise<void>;
    private _cleanup;
    private _ensureConnected;
    private _doConnect;
    private _reviveSession;
    private _replaceConnection;
    private _invalidateConnection;
    private _assertEpoch;
}
export declare class CuaConnectionReobserveRequiredError extends Error {
    readonly code = "COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED";
    constructor();
}
export declare class CuaConnectionRecoveryFailedError extends Error {
    readonly code = "COMPUTER_USE_CONNECTION_RECOVERY_FAILED";
    constructor(cause: unknown);
}
