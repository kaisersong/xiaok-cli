import {
  classifyWebSocketPayload,
  DEFAULT_WEBSOCKET_HEALTH,
  getReconnectDelayMs,
  shouldReconnectAfterInvalidFrames,
} from './yzj-websocket-client-helpers.js';
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

function defaultWebSocketFactory(url: string): WebSocketLike {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('WebSocket is not available in this Node.js runtime');
  }
  return new globalThis.WebSocket(url) as unknown as WebSocketLike;
}

function logInfo(logger: YZJLogger | undefined, message: string): void {
  logger?.info?.(message);
}

function isControlPayload(payload: unknown): boolean {
  if (typeof payload === 'string') {
    const normalized = payload.trim().toLowerCase();
    return normalized === 'ping' || normalized === 'pong';
  }
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
  const event = typeof record.event === 'string' ? record.event.toLowerCase() : '';
  return ['ping', 'pong', 'ack', 'close'].includes(type) || ['ping', 'pong', 'ack', 'close'].includes(event);
}

export class YZJWebSocketClient {
  private readonly url: string;
  private readonly logger?: YZJLogger;
  private readonly createSocket: WebSocketFactory;
  private readonly timers: TimerApi;
  private readonly onReady?: () => void;
  private readonly onDegraded?: (message: string) => void;
  private readonly onMessage: (message: YZJIncomingMessage) => Promise<void> | void;

  private socket: WebSocketLike | null = null;
  private stopped = false;
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMessageAt = 0;
  private lastPongAt = 0;
  private consecutiveInvalidFrames = 0;

  constructor(options: YZJWebSocketClientOptions) {
    this.url = options.url;
    this.logger = options.logger;
    this.createSocket = options.WebSocketFactory ?? defaultWebSocketFactory;
    this.timers = options.timers ?? globalThis;
    this.onReady = options.onReady;
    this.onDegraded = options.onDegraded;
    this.onMessage = options.onMessage;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.closeSocket(1000, 'shutdown');
  }

  private connect(): void {
    if (this.stopped) return;

    try {
      const socket = this.createSocket(this.url);
      this.socket = socket;
      this.bindSocket(socket);
      logInfo(this.logger, '[yzj] websocket connecting');
    } catch (error) {
      this.scheduleReconnect(`websocket connect failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private bindSocket(socket: WebSocketLike): void {
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
      void this.handleMessage((event as { data?: unknown }).data);
    });

    socket.addEventListener('error', () => {
      this.scheduleReconnect('websocket error');
    });

    socket.addEventListener('close', () => {
      this.scheduleReconnect('websocket closed');
    });
  }

  private async handleMessage(data: unknown): Promise<void> {
    this.lastMessageAt = Date.now();

    if (typeof data !== 'string') {
      this.consecutiveInvalidFrames += 1;
      if (shouldReconnectAfterInvalidFrames(this.consecutiveInvalidFrames)) {
        this.forceReconnect('too many invalid websocket frames');
      }
      return;
    }

    let payload: unknown = data;
    try {
      payload = JSON.parse(data);
    } catch {
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

  private handleControlPayload(payload: unknown): void {
    this.consecutiveInvalidFrames = 0;
    const normalized = typeof payload === 'string'
      ? payload.trim().toLowerCase()
      : String((payload as Record<string, unknown>).type ?? (payload as Record<string, unknown>).event ?? '').toLowerCase();
    if (normalized === 'pong' || normalized === 'ping') {
      this.lastPongAt = Date.now();
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) this.timers.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = this.timers.setInterval(() => {
      this.checkHealth();
    }, DEFAULT_WEBSOCKET_HEALTH.heartbeatMs);
  }

  private checkHealth(): void {
    const socket = this.socket;
    if (!socket || this.stopped) return;

    const now = Date.now();
    const lastActivity = Math.max(this.lastMessageAt, this.lastPongAt);
    if (lastActivity > 0 && now - lastActivity >= DEFAULT_WEBSOCKET_HEALTH.staleMs) {
      this.forceReconnect('websocket stale connection detected');
      return;
    }

    if (socket.readyState !== 1) return;

    try {
      if (typeof socket.ping === 'function') socket.ping();
      else socket.send(JSON.stringify({ cmd: 'ping' }));
    } catch (error) {
      this.scheduleReconnect(`websocket heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private forceReconnect(message: string): void {
    this.closeSocket(4000, message);
    this.scheduleReconnect(message);
  }

  private scheduleReconnect(message: string): void {
    if (this.stopped) return;
    if (this.reconnectTimer) return;

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

  private closeSocket(code?: number, reason?: string): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      socket.close(code, reason);
    } catch {
      // ignore close failures
    }
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    this.timers.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
