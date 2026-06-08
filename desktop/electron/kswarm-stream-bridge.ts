import type { WebContents, IpcMainInvokeEvent } from 'electron';

export interface KSwarmStreamEvent {
  type: string;
  [key: string]: unknown;
}

interface Subscription {
  webContents: WebContents;
  filter?: (event: KSwarmStreamEvent) => boolean;
}

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

export class KSwarmStreamBridge {
  private subscriptions = new Map<number, Subscription>();
  private connectionStatus: ConnectionStatus = 'disconnected';
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private wsUrl: string;
  private disposed = false;

  private static readonly RECONNECT_DELAY = 3000;
  private static readonly MAX_RECONNECT_DELAY = 60_000;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  start(): void {
    if (this.disposed) return;
    this.connect();
  }

  subscribe(event: IpcMainInvokeEvent, opts?: { filter?: (e: KSwarmStreamEvent) => boolean }): void {
    const id = event.sender.id;
    this.subscriptions.set(id, { webContents: event.sender, filter: opts?.filter });
    event.sender.once('destroyed', () => this.subscriptions.delete(id));
    event.sender.send('desktop:kswarm:connectionStatus', { status: this.connectionStatus });
  }

  unsubscribe(event: IpcMainInvokeEvent): void {
    this.subscriptions.delete(event.sender.id);
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
  }

  private connect(): void {
    if (this.disposed) return;
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.setConnectionStatus('reconnecting');

    try {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setConnectionStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as KSwarmStreamEvent;
          this.dispatchEvent(data);
        } catch {}
      };

      ws.onclose = () => {
        this.ws = null;
        this.setConnectionStatus('disconnected');
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        this.closeErroredSocket(ws);
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private closeErroredSocket(ws: WebSocket): void {
    if (this.ws !== ws) return;
    if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) return;
    try {
      ws.close();
    } catch {
      this.ws = null;
      this.setConnectionStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    const delay = Math.min(
      KSwarmStreamBridge.RECONNECT_DELAY * 2 ** this.reconnectAttempts,
      KSwarmStreamBridge.MAX_RECONNECT_DELAY,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private dispatchEvent(payload: KSwarmStreamEvent): void {
    for (const [id, sub] of this.subscriptions) {
      if (sub.webContents.isDestroyed()) {
        this.subscriptions.delete(id);
        continue;
      }
      if (sub.filter && !sub.filter(payload)) continue;
      sub.webContents.send('desktop:kswarm:wsEvent', payload);
    }
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    if (this.connectionStatus === status) return;
    this.connectionStatus = status;
    for (const [id, sub] of this.subscriptions) {
      if (sub.webContents.isDestroyed()) {
        this.subscriptions.delete(id);
        continue;
      }
      sub.webContents.send('desktop:kswarm:connectionStatus', { status });
    }
  }
}
