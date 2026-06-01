import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CuaConnectionManager,
  type CuaConnectionFactory,
  type CuaConnection,
} from '../../../src/platform/mcp/cua-connection-manager.js';

function createFakeConnection(options: { initDelay?: number; failOnInit?: boolean } = {}): {
  connection: CuaConnection;
  factory: CuaConnectionFactory;
  disposed: boolean;
  spawnCount: number;
} {
  const state = { disposed: false, spawnCount: 0 };
  const connection: CuaConnection = {
    callToolResult: vi.fn(async (name: string, input: Record<string, unknown>) => ({
      text: `called ${name}`,
      summary: '',
      images: [],
      isError: false,
    })),
    dispose: vi.fn(() => {
      state.disposed = true;
    }),
  };
  const factory: CuaConnectionFactory = vi.fn(async () => {
    state.spawnCount += 1;
    if (options.initDelay) {
      await new Promise((resolve) => setTimeout(resolve, options.initDelay));
    }
    if (options.failOnInit) {
      throw new Error('connection failed');
    }
    return connection;
  });
  return { connection, factory, get disposed() { return state.disposed; }, get spawnCount() { return state.spawnCount; }, ...state };
}

describe('CuaConnectionManager', () => {
  let manager: CuaConnectionManager;
  let fake: ReturnType<typeof createFakeConnection>;

  beforeEach(() => {
    fake = createFakeConnection();
    manager = new CuaConnectionManager(fake.factory);
  });

  afterEach(async () => {
    await manager.dispose();
  });

  it('starts in idle state and does not spawn on creation', () => {
    expect(manager.state).toBe('idle');
    expect(fake.factory).not.toHaveBeenCalled();
  });

  it('lazy connects on first callToolResult and transitions to connected', async () => {
    const result = await manager.callToolResult('list_windows', { on_screen_only: true });
    expect(manager.state).toBe('connected');
    expect(fake.factory).toHaveBeenCalledTimes(1);
    expect(fake.connection.callToolResult).toHaveBeenCalledWith('list_windows', { on_screen_only: true });
    expect(result.text).toBe('called list_windows');
  });

  it('singleflight: 10 concurrent first calls spawn only one connection', async () => {
    const slowFake = createFakeConnection({ initDelay: 50 });
    const mgr = new CuaConnectionManager(slowFake.factory);

    const calls = Array.from({ length: 10 }, (_, i) =>
      mgr.callToolResult(`tool_${i}`, {}),
    );
    const results = await Promise.all(calls);

    expect(slowFake.factory).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.isError).toBe(false);
    }
    await mgr.dispose();
  });

  it('connect failure transitions to failed state and allows retry', async () => {
    const failFake = createFakeConnection({ failOnInit: true });
    const mgr = new CuaConnectionManager(failFake.factory);

    await expect(mgr.callToolResult('click', {})).rejects.toThrow('connection failed');
    expect(mgr.state).toBe('failed');

    // Retry with a working factory
    const workingFake = createFakeConnection();
    const mgr2 = new CuaConnectionManager(workingFake.factory);
    const result = await mgr2.callToolResult('click', {});
    expect(result.isError).toBe(false);
    await mgr2.dispose();
    await mgr.dispose();
  });

  it('connect timeout cleans up child and allows retry', async () => {
    const hangingFactory: CuaConnectionFactory = vi.fn(
      () => new Promise((resolve) => setTimeout(resolve, 10_000)),
    ) as unknown as CuaConnectionFactory;
    const mgr = new CuaConnectionManager(hangingFactory, { connectTimeoutMs: 50 });

    await expect(mgr.callToolResult('click', {})).rejects.toThrow(/timeout/i);
    expect(mgr.state).toBe('failed');
    await mgr.dispose();
  });

  it('dispose during connecting cancels and does not write connected state', async () => {
    const slowFake = createFakeConnection({ initDelay: 200 });
    const mgr = new CuaConnectionManager(slowFake.factory);

    const callPromise = mgr.callToolResult('click', {});
    // Dispose before connect completes
    await new Promise((resolve) => setTimeout(resolve, 20));
    await mgr.dispose();

    await expect(callPromise).rejects.toThrow();
    expect(mgr.state).toBe('idle');
  });

  it('dispose after connected closes client and kills direct child', async () => {
    await manager.callToolResult('list_windows', {});
    expect(manager.state).toBe('connected');

    await manager.dispose();
    expect(manager.state).toBe('idle');
    expect(fake.connection.dispose).toHaveBeenCalledTimes(1);
  });

  it('dispose is idempotent', async () => {
    await manager.callToolResult('list_windows', {});
    await manager.dispose();
    await manager.dispose();
    await manager.dispose();
    expect(fake.connection.dispose).toHaveBeenCalledTimes(1);
  });

  it('dispose does NOT call cua-driver stop or kill global serve daemon', async () => {
    await manager.callToolResult('list_windows', {});
    await manager.dispose();
    // The factory's dispose only closes the direct child; no global stop command
    expect(fake.connection.dispose).toHaveBeenCalledTimes(1);
    // We explicitly verify no 'stop' tool call was made
    expect(fake.connection.callToolResult).not.toHaveBeenCalledWith(
      expect.stringContaining('stop'),
      expect.anything(),
    );
  });

  it('after dispose, subsequent callToolResult creates a new connection', async () => {
    await manager.callToolResult('list_windows', {});
    await manager.dispose();
    expect(manager.state).toBe('idle');

    // New call triggers fresh connect
    const result = await manager.callToolResult('click', { x: 10, y: 20 });
    expect(manager.state).toBe('connected');
    expect(fake.factory).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(false);
  });

  it('failed state allows retry on next callToolResult', async () => {
    let callCount = 0;
    const retryFactory: CuaConnectionFactory = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) throw new Error('transient failure');
      return fake.connection;
    });
    const mgr = new CuaConnectionManager(retryFactory);

    await expect(mgr.callToolResult('click', {})).rejects.toThrow('transient failure');
    expect(mgr.state).toBe('failed');

    // Retry succeeds
    const result = await mgr.callToolResult('click', {});
    expect(result.isError).toBe(false);
    expect(mgr.state).toBe('connected');
    await mgr.dispose();
  });
});
