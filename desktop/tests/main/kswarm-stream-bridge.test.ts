import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  beforeEach(() => {
    vi.useFakeTimers();
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
});
