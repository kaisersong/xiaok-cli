import { type XiaokDaemonRpcContext, type XiaokDaemonService, type XiaokDaemonServiceContext, type XiaokDaemonStatus } from '../daemon/host.js';
export interface ReminderDaemonServiceOptions {
    now?: () => number;
    scanIntervalMs?: number;
}
export interface ReminderDaemonServerOptions extends ReminderDaemonServiceOptions {
    socketPath: string;
    heartbeatTimeoutMs?: number;
}
export interface ReminderDaemonStatus extends XiaokDaemonStatus {
    workspaceCount: number;
}
export declare class ReminderDaemonService implements XiaokDaemonService {
    readonly name = "reminder";
    private readonly now;
    private readonly scanIntervalMs;
    private readonly registry;
    private readonly notifier;
    private readonly services;
    private context;
    constructor(options?: ReminderDaemonServiceOptions);
    start(context: XiaokDaemonServiceContext): void;
    onClientConnected(client: XiaokDaemonRpcContext['client']): void;
    onClientHeartbeat(client: XiaokDaemonRpcContext['client'], sentAt: number): void;
    onClientDisconnected(client: XiaokDaemonRpcContext['client']): void;
    handleRpc(context: XiaokDaemonRpcContext, _serviceContext: XiaokDaemonServiceContext): Promise<unknown>;
    getWorkspaceCount(): number;
    runOnceForWorkspace(workspaceRoot: string, defaultTimeZone?: string): Promise<void>;
    dispose(): Promise<void>;
    private getWorkspaceService;
}
export declare class ReminderDaemonServer {
    private readonly service;
    private readonly host;
    constructor(options: ReminderDaemonServerOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    getStatus(): ReminderDaemonStatus;
    runOnceForWorkspace(workspaceRoot: string, defaultTimeZone?: string): Promise<void>;
}
export declare function getReminderDaemonErrorMessage(error: unknown): string;
