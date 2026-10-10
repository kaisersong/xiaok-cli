import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KSwarmStreamBridge } from '../../electron/kswarm-stream-bridge';

function createMockWebContents(id: number) {
  const listeners: Record<string, Function[]> = {};
  return {
    id,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    once(event: string, fn: Function) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    _emit(event: string) {
      for (const fn of listeners[event] || []) fn();
    },
  };
}

function createMockEvent(webContents: any) {
  return { sender: webContents } as any;
}

describe('KSwarmStreamBridge', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  it('starts with disconnected status', () => {
    const bridge = new KSwarmStreamBridge('ws://localhost:9999/ws');
    expect(bridge.getConnectionStatus()).toBe('disconnected');
    bridge.dispose();
  });

  it('subscribes and unsubscribes webContents', () => {
    const bridge = new KSwarmStreamBridge('ws://localhost:9999/ws');
    const wc = createMockWebContents(1);
    const event = createMockEvent(wc);

    bridge.subscribe(event);
    expect(wc.send).toHaveBeenCalledWith('desktop:kswarm:connectionStatus', { status: 'disconnected' });

    bridge.unsubscribe(event);
    bridge.dispose();
  });

  it('removes subscription on webContents destroyed', () => {
    const bridge = new KSwarmStreamBridge('ws://localhost:9999/ws');
    const wc = createMockWebContents(1);
    const event = createMockEvent(wc);

    bridge.subscribe(event);
    wc._emit('destroyed');

    bridge.dispose();
  });

  it('dispose cleans up', () => {
    const bridge = new KSwarmStreamBridge('ws://localhost:9999/ws');
    bridge.dispose();
    expect(bridge.getConnectionStatus()).toBe('disconnected');
  });

  it('fences old socket callbacks after reconnection and notifies the main-owned observer', async () => {
    const sockets: any[] = [];
    class Socket {
      static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      readyState = 0; onopen?: () => void; onclose?: () => void; onmessage?: (event: { data: string }) => void;
      close() { this.readyState = 3; this.onclose?.(); }
      constructor(_url: string) { sockets.push(this); }
    }
    globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    const bridge = new KSwarmStreamBridge('ws://fixture');
    const events = vi.fn(), status = vi.fn();
    bridge.observeEvents(events); bridge.observeConnection(status); bridge.start();
    sockets[0].readyState = 1; sockets[0].onopen();
    sockets[0].close(); await vi.advanceTimersByTimeAsync(3000);
    sockets[1].readyState = 1; sockets[1].onopen();
    sockets[0].onmessage({ data: JSON.stringify({ type: 'project_activity', projectId: 'old' }) });
    sockets[0].onclose();
    expect(events).not.toHaveBeenCalled();
    expect(bridge.getConnectionStatus()).toBe('connected');
    expect(status).toHaveBeenLastCalledWith('connected'); bridge.dispose();
  });

  it('does not recursively close when an error fires while closing the socket', () => {
    const sockets: Array<{
      readyState: number;
      close: ReturnType<typeof vi.fn>;
      onerror: ((event?: unknown) => void) | null;
      onclose: (() => void) | null;
      onopen: (() => void) | null;
      onmessage: ((event: { data: string }) => void) | null;
    }> = [];

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      readyState = MockWebSocket.OPEN;
      onerror: ((event?: unknown) => void) | null = null;
      onclose: (() => void) | null = null;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      close = vi.fn(() => {
        if (this.close.mock.calls.length === 1) {
          this.onerror?.({ type: 'error-during-close' });
        }
        this.readyState = MockWebSocket.CLOSING;
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.();
      });

      constructor(_url: string) {
        sockets.push(this);
      }
    }

    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    const bridge = new KSwarmStreamBridge('ws://localhost:9999/ws');
    bridge.start();

    expect(sockets).toHaveLength(1);
    sockets[0].onerror?.({ type: 'initial-error' });

    expect(sockets[0].close).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });
});
