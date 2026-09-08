import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CuaConnectionManager,
  CuaConnectionReobserveRequiredError,
  type CuaConnectionFactory,
  type CuaConnection,
} from '../../../src/platform/mcp/cua-connection-manager.js';
import {
  classifyCuaRuntimeFailure,
  isReplaySafeCuaCall,
} from '../../../src/platform/mcp/cua-runtime-failure.js';

interface CuaFailureFixtures {
  driverVersion: string;
  sessionEndedResult: string;
  sessionEndedException: string;
  transportClosedException: string;
  daemonUnreachableResult: string;
  authorizationBeforeSession: string;
}

const failureFixtures = JSON.parse(readFileSync(
  join(process.cwd(), 'tests', 'fixtures', 'cua-runtime-failure-messages.json'),
  'utf8',
)) as CuaFailureFixtures;

function ok(text = 'ok') {
  return { text, summary: text, images: [], isError: false };
}

function failed(message: string) {
  return { text: message, summary: message, images: [], isError: true };
}

describe('recovery and per-call cancellation integration', () => {
  it('does not cancel a sibling revive or replay the cancelled caller', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const a = new AbortController(), b = new AbortController();
    const reason = new Error('EPIPE cancelled caller');
    let revived = false;
    const connection: CuaConnection = { dispose: vi.fn(), callToolResult: vi.fn(async (name, _input, options) => {
      if (name === 'start_session') { expect(options).toBeUndefined(); await gate; revived = true; return ok(); }
      expect(options?.signal === a.signal || options?.signal === b.signal).toBe(true);
      return revived ? ok('fresh') : failed(failureFixtures.sessionEndedResult);
    }) };
    const manager = new CuaConnectionManager(async () => connection);
    const first = manager.callToolResult('list_windows', {}, { signal: a.signal }).catch(error => error);
    const second = manager.callToolResult('list_windows', {}, { signal: b.signal });
    await vi.waitFor(() => expect(connection.callToolResult).toHaveBeenCalledTimes(3));
    a.abort(reason); release();
    expect(await first).toBe(reason);
    await expect(second).resolves.toMatchObject({ text: 'fresh' });
    expect(connection.callToolResult).toHaveBeenCalledTimes(4);
    expect(connection.dispose).not.toHaveBeenCalled();
    await manager.dispose();
  });
  it('does not classify an aborted transport outcome as a recovery request', async () => {
    const controller = new AbortController();
    const reason = new Error('EPIPE cancelled caller');
    const connection: CuaConnection = { dispose: vi.fn(), callToolResult: vi.fn(async () => {
      controller.abort(reason); throw new Error(failureFixtures.transportClosedException);
    }) };
    const factory = vi.fn(async () => connection);
    const manager = new CuaConnectionManager(factory);
    await expect(manager.callToolResult('list_windows', {}, { signal: controller.signal })).rejects.toBe(reason);
    expect(factory).toHaveBeenCalledTimes(1); expect(connection.dispose).not.toHaveBeenCalled();
    await manager.dispose();
  });
});

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

  it('classifies real 0.23.2 runtime failures with authorization taking priority', () => {
    expect(failureFixtures.driverVersion).toBe('0.23.2');
    expect(classifyCuaRuntimeFailure(failed(failureFixtures.sessionEndedResult))).toMatchObject({
      kind: 'session_ended',
    });
    expect(classifyCuaRuntimeFailure(new Error(failureFixtures.sessionEndedException))).toMatchObject({
      kind: 'session_ended',
    });
    expect(classifyCuaRuntimeFailure(new Error(failureFixtures.transportClosedException))).toMatchObject({
      kind: 'transport_closed',
    });
    expect(classifyCuaRuntimeFailure(failed(failureFixtures.daemonUnreachableResult))).toMatchObject({
      kind: 'daemon_unreachable',
    });
    expect(classifyCuaRuntimeFailure(failed(failureFixtures.authorizationBeforeSession))).toMatchObject({
      kind: 'authorization_denied',
    });
    expect(classifyCuaRuntimeFailure(ok(failureFixtures.sessionEndedResult))).toBeNull();
  });

  it('treats only side-effect-free observation calls as replay safe', () => {
    expect(isReplaySafeCuaCall('list_apps', {})).toBe(true);
    expect(isReplaySafeCuaCall('list_windows', { on_screen_only: true })).toBe(true);
    expect(isReplaySafeCuaCall('get_window_state', { pid: 1, window_id: 2, include_screenshot: true })).toBe(true);
    expect(isReplaySafeCuaCall('get_window_state', { pid: 1, window_id: 2, screenshot_out_file: '/tmp/capture.png' })).toBe(false);
    expect(isReplaySafeCuaCall('get_window_state', { pid: 1, window_id: 2, javascript: 'mutate()' })).toBe(false);
    expect(isReplaySafeCuaCall('click', { x: 10, y: 20 })).toBe(false);
    expect(isReplaySafeCuaCall('future_readish_name', {})).toBe(false);
  });

  it('revives one ended implicit session and retries one observation on the same connection', async () => {
    let revived = false;
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const connection: CuaConnection = {
      callToolResult: vi.fn(async (name, input) => {
        calls.push({ name, input });
        if (name === 'start_session') {
          revived = true;
          return ok('session revived');
        }
        return revived ? ok('windows') : failed(failureFixtures.sessionEndedResult);
      }),
      dispose: vi.fn(),
    };
    const factory = vi.fn(async () => connection);
    const mgr = new CuaConnectionManager(factory);

    await expect(mgr.callToolResult('list_windows', { on_screen_only: true }))
      .resolves.toMatchObject({ isError: false, text: 'windows' });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      { name: 'list_windows', input: { on_screen_only: true } },
      { name: 'start_session', input: {} },
      { name: 'list_windows', input: { on_screen_only: true } },
    ]);
    await mgr.dispose();
  });

  it('singleflights session revival for concurrent ended observations', async () => {
    let revived = false;
    let releaseRevive!: () => void;
    const reviveGate = new Promise<void>((resolve) => { releaseRevive = resolve; });
    const connection: CuaConnection = {
      callToolResult: vi.fn(async (name) => {
        if (name === 'start_session') {
          await reviveGate;
          revived = true;
          return ok('session revived');
        }
        return revived ? ok('windows') : failed(failureFixtures.sessionEndedResult);
      }),
      dispose: vi.fn(),
    };
    const factory = vi.fn(async () => connection);
    const mgr = new CuaConnectionManager(factory);

    const calls = Array.from({ length: 10 }, () => mgr.callToolResult('list_windows', {}));
    await vi.waitFor(() => {
      expect(connection.callToolResult).toHaveBeenCalledWith('start_session', {});
    });
    releaseRevive();
    await expect(Promise.all(calls)).resolves.toHaveLength(10);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(connection.callToolResult).toHaveBeenCalledTimes(21);
    expect((connection.callToolResult as ReturnType<typeof vi.fn>).mock.calls
      .filter(([name]) => name === 'start_session')).toHaveLength(1);
    await mgr.dispose();
  });

  it('does not merge concurrent revival for different explicit session labels', async () => {
    const revived = new Set<string>();
    const connection: CuaConnection = {
      callToolResult: vi.fn(async (name, input) => {
        if (name === 'start_session') {
          revived.add(String(input.session));
          return ok(`revived ${String(input.session)}`);
        }
        return revived.has(String(input.session))
          ? ok(`windows ${String(input.session)}`)
          : failed(failureFixtures.sessionEndedResult);
      }),
      dispose: vi.fn(),
    };
    const mgr = new CuaConnectionManager(async () => connection);

    await expect(Promise.all([
      mgr.callToolResult('list_windows', { session: 'research-a' }),
      mgr.callToolResult('list_windows', { session: 'research-b' }),
    ])).resolves.toHaveLength(2);

    expect((connection.callToolResult as ReturnType<typeof vi.fn>).mock.calls
      .filter(([name]) => name === 'start_session')).toEqual([
      ['start_session', { session: 'research-a' }],
      ['start_session', { session: 'research-b' }],
    ]);
    await mgr.dispose();
  });

  it('revives only the explicit session label from input and never parses the internal error id', async () => {
    let revived = false;
    const connection: CuaConnection = {
      callToolResult: vi.fn(async (name) => {
        if (name === 'start_session') {
          revived = true;
          return ok('session revived');
        }
        return revived ? ok('windows') : failed(failureFixtures.sessionEndedResult);
      }),
      dispose: vi.fn(),
    };
    const mgr = new CuaConnectionManager(async () => connection);

    await mgr.callToolResult('list_windows', { session: 'research-run-1' });

    expect(connection.callToolResult).toHaveBeenCalledWith('start_session', { session: 'research-run-1' });
    expect(connection.callToolResult).not.toHaveBeenCalledWith('start_session', {
      session: expect.stringContaining('mcp-59792'),
    });
    await mgr.dispose();
  });

  it('restores the session but never replays a mutation or its future follow-up', async () => {
    const connection: CuaConnection = {
      callToolResult: vi.fn(async (name) => (
        name === 'start_session' ? ok('session revived') : failed(failureFixtures.sessionEndedResult)
      )),
      dispose: vi.fn(),
    };
    const mgr = new CuaConnectionManager(async () => connection);

    await expect(mgr.callToolResult('click', { x: 10, y: 20 }))
      .rejects.toBeInstanceOf(CuaConnectionReobserveRequiredError);

    expect((connection.callToolResult as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['click', { x: 10, y: 20 }],
      ['start_session', {}],
    ]);
    expect(mgr.state).toBe('connected');
    await mgr.dispose();
  });

  it('replaces the transport once when session revival fails, then replays an observation', async () => {
    const first: CuaConnection = {
      callToolResult: vi.fn(async (name) => (
        name === 'start_session'
          ? failed('session revival failed')
          : failed(failureFixtures.sessionEndedResult)
      )),
      dispose: vi.fn(),
    };
    const second: CuaConnection = {
      callToolResult: vi.fn(async () => ok('fresh windows')),
      dispose: vi.fn(),
    };
    const factory = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const mgr = new CuaConnectionManager(factory);

    await expect(mgr.callToolResult('list_windows', {}))
      .resolves.toMatchObject({ isError: false, text: 'fresh windows' });

    expect(factory).toHaveBeenCalledTimes(2);
    expect(first.callToolResult).toHaveBeenCalledTimes(2);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.callToolResult).toHaveBeenCalledTimes(1);
    await mgr.dispose();
  });

  it('replaces a closed transport once and replays only an observation', async () => {
    const first: CuaConnection = {
      callToolResult: vi.fn(async () => { throw new Error(failureFixtures.transportClosedException); }),
      dispose: vi.fn(),
    };
    const second: CuaConnection = {
      callToolResult: vi.fn(async () => ok('fresh windows')),
      dispose: vi.fn(),
    };
    const factory = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const mgr = new CuaConnectionManager(factory);

    await expect(mgr.callToolResult('list_windows', {})).resolves.toMatchObject({ text: 'fresh windows' });

    expect(factory).toHaveBeenCalledTimes(2);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.callToolResult).toHaveBeenCalledTimes(1);
    await mgr.dispose();
  });

  it('replaces a closed transport but does not replay an ambiguous mutation', async () => {
    const first: CuaConnection = {
      callToolResult: vi.fn(async () => { throw new Error(failureFixtures.transportClosedException); }),
      dispose: vi.fn(),
    };
    const second: CuaConnection = {
      callToolResult: vi.fn(async () => ok('fresh connection')),
      dispose: vi.fn(),
    };
    const factory = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const mgr = new CuaConnectionManager(factory);

    await expect(mgr.callToolResult('click', { x: 10, y: 20 }))
      .rejects.toBeInstanceOf(CuaConnectionReobserveRequiredError);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(second.callToolResult).not.toHaveBeenCalledWith('click', expect.anything());
    await expect(mgr.callToolResult('list_windows', {})).resolves.toMatchObject({ isError: false });
    await mgr.dispose();
  });

  it('does not revive or reconnect authorization failures containing a session-ended suffix', async () => {
    const connection: CuaConnection = {
      callToolResult: vi.fn(async () => failed(failureFixtures.authorizationBeforeSession)),
      dispose: vi.fn(),
    };
    const factory = vi.fn(async () => connection);
    const mgr = new CuaConnectionManager(factory);

    await expect(mgr.callToolResult('list_windows', {})).resolves.toMatchObject({
      isError: true,
      text: failureFixtures.authorizationBeforeSession,
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(connection.callToolResult).toHaveBeenCalledTimes(1);
    await mgr.dispose();
  });

  it('bounds recovery to one replay and invalidates a session that immediately ends again', async () => {
    const connection: CuaConnection = {
      callToolResult: vi.fn(async (name) => (
        name === 'start_session' ? ok('session revived') : failed(failureFixtures.sessionEndedResult)
      )),
      dispose: vi.fn(),
    };
    const mgr = new CuaConnectionManager(async () => connection);

    await expect(mgr.callToolResult('list_windows', {})).resolves.toMatchObject({ isError: true });

    expect(connection.callToolResult).toHaveBeenCalledTimes(3);
    expect(connection.dispose).toHaveBeenCalledTimes(1);
    expect(mgr.state).toBe('idle');
    await mgr.dispose();
  });

  it('does not let dispose during revive replay or resurrect the old epoch', async () => {
    let releaseRevive!: () => void;
    const reviveGate = new Promise<void>((resolve) => { releaseRevive = resolve; });
    const connection: CuaConnection = {
      callToolResult: vi.fn(async (name) => {
        if (name === 'start_session') {
          await reviveGate;
          return ok('session revived');
        }
        return failed(failureFixtures.sessionEndedResult);
      }),
      dispose: vi.fn(),
    };
    const manager = new CuaConnectionManager(async () => connection);
    const call = manager.callToolResult('list_windows', {});
    await vi.waitFor(() => expect(connection.callToolResult).toHaveBeenCalledWith('start_session', {}));

    const disposing = manager.dispose();
    releaseRevive();

    await disposing;
    await expect(call).rejects.toThrow(/cancelled|disposed/i);
    expect(connection.callToolResult).toHaveBeenCalledTimes(2);
    expect(connection.dispose).toHaveBeenCalledTimes(1);
    expect(manager.state).toBe('idle');
  });
});
