import { classifyWebSocketPayload, DEFAULT_WEBSOCKET_HEALTH, getReconnectDelayMs, shouldReconnectAfterInvalidFrames, } from './yzj-websocket-client-helpers.js';
function defaultWebSocketFactory(url) {
    if (typeof globalThis.WebSocket !== 'function') {
        throw new Error('WebSocket is not available in this Node.js runtime');
    }
    return new globalThis.WebSocket(url);
}
function logInfo(logger, message) {
    logger?.info?.(message);
}
function isControlPayload(payload) {
    if (typeof payload === 'string') {
        const normalized = payload.trim().toLowerCase();
        return normalized === 'ping' || normalized === 'pong';
    }
    if (!payload || typeof payload !== 'object')
        return false;
    const record = payload;
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
    const event = typeof record.event === 'string' ? record.event.toLowerCase() : '';
    return ['ping', 'pong', 'ack', 'close'].includes(type) || ['ping', 'pong', 'ack', 'close'].includes(event);
}
export class YZJWebSocketClient {
    url;
    logger;
    createSocket;
    timers;
    onReady;
    onDegraded;
    onMessage;
    socket = null;
    stopped = false;
    reconnectAttempts = 0;
    heartbeatTimer = null;
    reconnectTimer = null;
    lastMessageAt = 0;
    lastPongAt = 0;
    consecutiveInvalidFrames = 0;
    constructor(options) {
        this.url = options.url;
        this.logger = options.logger;
        this.createSocket = options.WebSocketFactory ?? defaultWebSocketFactory;
        this.timers = options.timers ?? globalThis;
        this.onReady = options.onReady;
        this.onDegraded = options.onDegraded;
        this.onMessage = options.onMessage;
    }
    start() {
        this.stopped = false;
        this.connect();
    }
    stop() {
        this.stopped = true;
        this.clearTimers();
        this.closeSocket(1000, 'shutdown');
    }
    connect() {
        if (this.stopped)
            return;
        try {
            const socket = this.createSocket(this.url);
            this.socket = socket;
            this.bindSocket(socket);
            logInfo(this.logger, '[yzj] websocket connecting');
        }
        catch (error) {
            this.scheduleReconnect(`websocket connect failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    bindSocket(socket) {
        socket.addEventListener('open', () => {
            this.reconnectAttempts = 0;
            this.lastMessageAt = Date.now();
            this.lastPongAt = Date.now();
            this.consecutiveInvalidFrames = 0;
            this.startHeartbeat();
            this.onReady?.();
            logInfo(this.logger, '[yzj] websocket connected');
        });
        socket.addEventListener('message', (event) => {
            void this.handleMessage(event.data);
        });
        socket.addEventListener('error', () => {
            this.scheduleReconnect('websocket error');
        });
        socket.addEventListener('close', () => {
            this.scheduleReconnect('websocket closed');
        });
    }
    async handleMessage(data) {
        this.lastMessageAt = Date.now();
        if (typeof data !== 'string') {
            this.consecutiveInvalidFrames += 1;
            if (shouldReconnectAfterInvalidFrames(this.consecutiveInvalidFrames)) {
                this.forceReconnect('too many invalid websocket frames');
            }
            return;
        }
        let payload = data;
        try {
            payload = JSON.parse(data);
        }
        catch {
            if (isControlPayload(data)) {
                this.handleControlPayload(data);
                return;
            }
            this.consecutiveInvalidFrames += 1;
            this.logger?.warn?.('[yzj] invalid websocket frame');
            if (shouldReconnectAfterInvalidFrames(this.consecutiveInvalidFrames)) {
                this.forceReconnect('too many invalid websocket frames');
            }
            return;
        }
        const classified = classifyWebSocketPayload(payload);
        if (classified.kind === 'control') {
            this.handleControlPayload(payload);
            if (classified.ack && this.socket?.readyState === 1) {
                this.socket.send(classified.ack);
            }
            return;
        }
        if (classified.kind !== 'dispatch') {
            this.consecutiveInvalidFrames += 1;
            this.logger?.warn?.(`[yzj] websocket payload missing required fields: ${JSON.stringify(payload)}`);
            if (shouldReconnectAfterInvalidFrames(this.consecutiveInvalidFrames)) {
                this.forceReconnect('too many invalid websocket frames');
            }
            return;
        }
        this.consecutiveInvalidFrames = 0;
        await this.onMessage(classified.message);
    }
    handleControlPayload(payload) {
        this.consecutiveInvalidFrames = 0;
        const normalized = typeof payload === 'string'
            ? payload.trim().toLowerCase()
            : String(payload.type ?? payload.event ?? '').toLowerCase();
        if (normalized === 'pong' || normalized === 'ping') {
            this.lastPongAt = Date.now();
        }
    }
    startHeartbeat() {
        if (this.heartbeatTimer)
            this.timers.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = this.timers.setInterval(() => {
            this.checkHealth();
        }, DEFAULT_WEBSOCKET_HEALTH.heartbeatMs);
    }
    checkHealth() {
        const socket = this.socket;
        if (!socket || this.stopped)
            return;
        const now = Date.now();
        const lastActivity = Math.max(this.lastMessageAt, this.lastPongAt);
        if (lastActivity > 0 && now - lastActivity >= DEFAULT_WEBSOCKET_HEALTH.staleMs) {
            this.forceReconnect('websocket stale connection detected');
            return;
        }
        if (socket.readyState !== 1)
            return;
        try {
            if (typeof socket.ping === 'function')
                socket.ping();
            else
                socket.send(JSON.stringify({ cmd: 'ping' }));
        }
        catch (error) {
            this.scheduleReconnect(`websocket heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    forceReconnect(message) {
        this.closeSocket(4000, message);
        this.scheduleReconnect(message);
    }
    scheduleReconnect(message) {
        if (this.stopped)
            return;
        if (this.reconnectTimer)
            return;
        this.onDegraded?.(message);
        this.logger?.warn?.(`[yzj] ${message}`);
        this.clearHeartbeat();
        const delay = getReconnectDelayMs(this.reconnectAttempts);
        this.reconnectAttempts += 1;
        this.reconnectTimer = this.timers.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
        this.logger?.warn?.(`[yzj] websocket reconnect scheduled in ${delay}ms`);
    }
    closeSocket(code, reason) {
        const socket = this.socket;
        this.socket = null;
        if (!socket)
            return;
        try {
            socket.close(code, reason);
        }
        catch {
            // ignore close failures
        }
    }
    clearHeartbeat() {
        if (!this.heartbeatTimer)
            return;
        this.timers.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
    }
    clearTimers() {
        this.clearHeartbeat();
        if (this.reconnectTimer) {
            this.timers.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
