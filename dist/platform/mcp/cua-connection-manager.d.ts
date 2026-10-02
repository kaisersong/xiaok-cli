import type { McpInvocationOptions, McpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';
export interface CuaConnection {
    callToolResult(name: string, input: Record<string, unknown>, options?: McpInvocationOptions): Promise<McpRuntimeToolResult>;
    dispose(): void | Promise<void>;
}
export type CuaConnectionFactory = () => Promise<CuaConnection>;
export type CuaConnectionState = 'idle' | 'connecting' | 'connected' | 'closing' | 'failed';
export interface CuaConnectionManagerOptions {
    connectTimeoutMs?: number;
    initialConnection?: CuaConnection;
    isReplaySafeCall?: (operation: string, input: Readonly<Record<string, unknown>>) => boolean;
}
export declare class CuaConnectionManager {
    private _state;
    private _connection;
    private _connectPromise;
    private _epoch;
    private _generation;
    private readonly _isReplaySafeCall;
    private readonly _pendingCloses;
    private readonly _revivePromises;
    private readonly _factory;
    private readonly _connectTimeoutMs;
    constructor(factory: CuaConnectionFactory, options?: CuaConnectionManagerOptions);
    get state(): CuaConnectionState;
    get generation(): number;
    callToolResult(name: string, input: Record<string, unknown>, options?: McpInvocationOptions): Promise<McpRuntimeToolResult>;
    dispose(): Promise<void>;
    private _closeConnection;
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
