import type { XiaokDaemonClientInfo } from './protocol.js';
export interface XiaokDaemonServiceContext {
    readonly now: () => number;
    emitEvent(clientInstanceId: string, name: string, payload: Record<string, unknown>): void;
    listActiveClients(): XiaokDaemonClientInfo[];
}
export interface XiaokDaemonRpcContext {
    client: XiaokDaemonClientInfo;
    method: string;
    params: Record<string, unknown>;
}
export interface XiaokDaemonService {
    name: string;
    start?(context: XiaokDaemonServiceContext): Promise<void> | void;
    onClientConnected?(client: XiaokDaemonClientInfo, context: XiaokDaemonServiceContext): Promise<void> | void;
    onClientHeartbeat?(client: XiaokDaemonClientInfo, sentAt: number, context: XiaokDaemonServiceContext): Promise<void> | void;
    onClientDisconnected?(client: XiaokDaemonClientInfo, context: XiaokDaemonServiceContext): Promise<void> | void;
    handleRpc(context: XiaokDaemonRpcContext, serviceContext: XiaokDaemonServiceContext): Promise<unknown> | unknown;
    dispose?(): Promise<void> | void;
}
export interface XiaokDaemonHostOptions {
    socketPath: string;
    services?: XiaokDaemonService[];
    now?: () => number;
    heartbeatTimeoutMs?: number;
}
export interface XiaokDaemonStatus {
    running: boolean;
    socketPath: string;
    daemonVersion: string;
    protocolVersion: number;
    activeClients: number;
    activeSessions: number;
    serviceNames: string[];
}
export declare class XiaokDaemonHost {
    private readonly options;
    private readonly now;
    private readonly heartbeatTimeoutMs;
    private readonly services;
    private readonly serviceContexts;
    private readonly connections;
    private readonly clientsById;
    private server;
    private heartbeatTimer;
    constructor(options: XiaokDaemonHostOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    getStatus(): XiaokDaemonStatus;
    private listActiveClients;
    private handleData;
    private handleMessage;
    private handleHello;
    private handleHeartbeat;
    private handleRpc;
    private executeControlRpc;
    private executeServiceRpc;
    private handleDisconnect;
    private expireStaleConnections;
    private emitServiceEvent;
    private writeMessage;
    private toClientInfo;
    private cleanupSocketFile;
}
