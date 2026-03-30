import type { YZJIncomingMessage, YZJLogger } from './yzj-types.js';
type WebSocketLike = {
    readyState: number;
    send: (data: string) => void;
    close: (code?: number, reason?: string) => void;
    addEventListener: (type: string, listener: (event: unknown) => void) => void;
    ping?: () => void;
};
type WebSocketFactory = (url: string) => WebSocketLike;
type TimerApi = {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
};
export interface YZJWebSocketClientOptions {
    url: string;
    logger?: YZJLogger;
    WebSocketFactory?: WebSocketFactory;
    timers?: TimerApi;
    onReady?: () => void;
    onDegraded?: (message: string) => void;
    onMessage: (message: YZJIncomingMessage) => Promise<void> | void;
}
export declare class YZJWebSocketClient {
    private readonly url;
    private readonly logger?;
    private readonly createSocket;
    private readonly timers;
    private readonly onReady?;
    private readonly onDegraded?;
    private readonly onMessage;
    private socket;
    private stopped;
    private reconnectAttempts;
    private heartbeatTimer;
    private reconnectTimer;
    private lastMessageAt;
    private lastPongAt;
    private consecutiveInvalidFrames;
    constructor(options: YZJWebSocketClientOptions);
    start(): void;
    stop(): void;
    private connect;
    private bindSocket;
    private handleMessage;
    private handleControlPayload;
    private startHeartbeat;
    private checkHealth;
    private forceReconnect;
    private scheduleReconnect;
    private closeSocket;
    private clearHeartbeat;
    private clearTimers;
}
export {};
