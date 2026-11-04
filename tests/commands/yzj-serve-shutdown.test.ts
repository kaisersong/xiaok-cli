import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryStore } from '../../src/ai/memory/store.js';
import { PidLock } from '../../src/utils/pid-lock.js';

// In-process cases: segmentation of the last raw message waits on a per-test gate (deferred,
// no sleep), and the store yzj serve creates is captured together with its close() call.
const h = vi.hoisted(() => {
  const state = { home: '', rawWriteSessions: [] as string[], adaptersCreated: 0 } as {
    home: string; rawWriteSessions: string[]; adaptersCreated: number;
    gate: Promise<void>; release: () => void;
    closeCalled: Promise<'close-called'>; notifyClose: () => void;
    storeCreated: Promise<MemoryStore>; notifyStore: (store: MemoryStore) => void;
  };
  const reset = () => {
    state.gate = new Promise<void>((resolve) => { state.release = resolve; });
    state.closeCalled = new Promise((resolve) => { state.notifyClose = () => resolve('close-called'); });
    state.storeCreated = new Promise((resolve) => { state.notifyStore = resolve; });
    state.rawWriteSessions = [];
    state.adaptersCreated = 0;
  };
  reset();
  return { state, reset };
});
// serve keeps its pid file and stores under os.homedir(). Under the sandbox threads pool a worker's
// process.env.HOME does not reach os.homedir(), so point it at the per-test home explicitly.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const homedir = () => h.state.home || actual.homedir();
  const userInfo = ((options?: { encoding: BufferEncoding }) => ({ ...actual.userInfo(options), homedir: homedir() })) as typeof actual.userInfo;
  return { ...actual, homedir, userInfo, default: { ...actual, homedir, userInfo } };
});
vi.mock('../../src/ai/memory/segment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ai/memory/segment.js')>();
  return { ...actual, segmentChineseAsync: async (text: string) => { await h.state.gate; return text; } };
});
vi.mock('../../src/ai/memory/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ai/memory/store.js')>();
  return {
    ...actual,
    createMemoryStoreAsync: async (config?: Record<string, unknown>) => {
      const store = await actual.createMemoryStoreAsync(config);
      const realClose = store.close?.bind(store);
      store.close = () => { h.state.notifyClose(); return realClose?.(); };
      const realWrite = store.writeRawMessage?.bind(store);
      if (realWrite) {
        store.writeRawMessage = (sessionId, ...rest) => { h.state.rawWriteSessions.push(sessionId); return realWrite(sessionId, ...rest); };
      }
      h.state.notifyStore(store);
      return store;
    },
  };
});

// Only the non-dry-run case gets here: serve builds a model adapter but no message ever reaches it,
// so a stub stands in for real model config and API keys (no network).
vi.mock('../../src/ai/models.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ai/models.js')>();
  return { ...actual, createAdapter: () => { h.state.adaptersCreated += 1; return {} as ReturnType<typeof actual.createAdapter>; } };
});

import { registerYZJCommands, YZJ_SERVE_EXIT_CODES, YZJ_SHUTDOWN_FORCE_EXIT_MS } from '../../src/commands/yzj.js';

const LAST_MESSAGE = 'yzj 退出前最后一笔：南京市长江大桥';
const SERVE_ARGS = ['yzjchannel', 'serve', '--webhook-url', 'https://example.invalid/hook'];
const turn = () => new Promise<'still-waiting'>((resolve) => setImmediate(() => resolve('still-waiting')));

function readProbeRows(dbPath: string): unknown[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare('SELECT session_id, content FROM memory_l0_raw WHERE session_id = ?').all(PROBE_SESSION);
  } finally {
    db.close();
  }
}

function readRawRow(dbPath: string, content: string): unknown {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare('SELECT session_id, role, content FROM memory_l0_raw WHERE content = ?').get(content);
  } finally {
    db.close();
  }
}

let base: string;
const priorEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XIAOK_CONFIG_DIR: process.env.XIAOK_CONFIG_DIR,
  XIAOK_YZJ_DRY_RUN_PROBE_WRITE: process.env.XIAOK_YZJ_DRY_RUN_PROBE_WRITE,
};
const PROBE_SESSION = 'yzj-dry-run-probe';
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'xiaok-yzj-shutdown-'));
});
afterEach(() => {
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(base, { recursive: true, force: true });
});

// #150: agent-runtime's writeRawMessage is fire-and-forget and waits for async segmentation.
// A shutdown signal must let that last write land: PidLock no longer exits on signals, yzj
// serve closes (and awaits) the memory store, then exits with a defined code.
describe('yzj serve shutdown with a raw write in flight (#150, in-process)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let before: { SIGINT: Set<unknown>; SIGTERM: Set<unknown>; exit: Set<unknown> };
  let running: Promise<unknown> | undefined;

  beforeEach(() => {
    h.reset();
    h.state.home = join(base, 'home');
    process.env.HOME = h.state.home;
    process.env.USERPROFILE = h.state.home;
    process.env.XIAOK_CONFIG_DIR = join(base, 'config');
    // The serve action exits the process at the end; record the code instead.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    // Only the shutdown deadlines are faked; nothing advances them unless a case does.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    before = {
      SIGINT: new Set(process.listeners('SIGINT')),
      SIGTERM: new Set(process.listeners('SIGTERM')),
      exit: new Set(process.listeners('exit')),
    };
  });
  afterEach(async () => {
    h.state.release();
    expect(existsSync(join(h.state.home, '.xiaok', 'state', 'yzj', 'serve.pid'))).toBe(true);
    // Let a serve left running by a failed assertion finish while process.exit is still mocked.
    await running?.catch(() => undefined);
    running = undefined;
    h.state.home = '';
    vi.useRealTimers();
    exitSpy.mockRestore();
    // Drop listeners serve/PidLock left on this worker (the pid-file release on 'exit' among them).
    for (const event of ['SIGINT', 'SIGTERM', 'exit'] as const) {
      for (const listener of process.listeners(event)) {
        if (!before[event].has(listener)) process.off(event, listener as () => void);
      }
    }
  });

  const DRY_RUN_WEBSOCKET = ['--inbound-mode', 'websocket', '--no-webhook', '--dry-run'];

  /**
   * Start serve, wait until it idles on its shutdown signal (gateway started), and unless told
   * otherwise put the last raw write in flight.
   */
  async function startServe(args: string[] = DRY_RUN_WEBSOCKET, { writeInFlight = true } = {}) {
    const info = vi.spyOn(console, 'info');
    const program = new Command();
    program.exitOverride();
    registerYZJCommands(program);
    const serve = program.parseAsync(['node', 'xiaok', ...SERVE_ARGS, ...args]);
    running = serve;
    const settled = serve.then(() => 'serve-returned' as const);
    void settled.catch(() => undefined);
    const store = await h.state.storeCreated;
    const started = () => info.mock.calls.some(([line]) => String(line).startsWith('[yzj] gateway started'));
    while (!started()) {
      const done = await Promise.race([settled, turn()]);
      if (done === 'serve-returned') throw new Error('serve returned before the gateway started');
    }
    info.mockRestore();
    // Same call agent-runtime makes for the last user message: not awaited.
    if (writeInFlight) void store.writeRawMessage!('yzj-session', 'user', LAST_MESSAGE);
    // Every listener for the signal added since the start, in registration order, as Node delivers it.
    const deliver = (signal: 'SIGINT' | 'SIGTERM') => {
      for (const listener of process.listeners(signal)) if (!before[signal].has(listener)) (listener as (s: NodeJS.Signals) => void)(signal);
    };
    return { serve, settled, deliverSigint: () => deliver('SIGINT'), deliverSigterm: () => deliver('SIGTERM') };
  }

  it('SIGINT waits for the in-flight write, exits 0, and the row is in memory.db after reopening', async () => {
    const { serve, settled, deliverSigint } = await startServe();
    deliverSigint();

    // Shutdown must reach close() (fails if the close line is removed)...
    expect(await Promise.race([settled, h.state.closeCalled])).toBe('close-called');
    // ...and must not return while the write still waits on segmentation (fails if close() is not awaited).
    expect(await Promise.race([settled, turn()])).toBe('still-waiting');

    h.state.release();
    await serve;
    // Exactly one exit, the graceful one (fails if PidLock exits on SIGINT again: 130 comes first).
    expect(exitSpy.mock.calls).toEqual([[YZJ_SERVE_EXIT_CODES.graceful]]);
    expect(readRawRow(join(base, 'config', 'memory.db'), LAST_MESSAGE)).toEqual({ session_id: 'yzj-session', role: 'user', content: LAST_MESSAGE });
  });

  it(`a shutdown still running after ${YZJ_SHUTDOWN_FORCE_EXIT_MS}ms is forced to exit ${YZJ_SERVE_EXIT_CODES.shutdownTimeout}`, async () => {
    const { serve, deliverSigint } = await startServe();
    deliverSigint();
    await h.state.closeCalled;

    await vi.advanceTimersByTimeAsync(YZJ_SHUTDOWN_FORCE_EXIT_MS - 1);
    expect(exitSpy.mock.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(exitSpy.mock.calls[0]).toEqual([YZJ_SERVE_EXIT_CODES.shutdownTimeout]);

    h.state.release();
    await serve;
  });

  it(`a second SIGINT during shutdown exits ${YZJ_SERVE_EXIT_CODES.SIGINT} at once`, async () => {
    const { serve, deliverSigint } = await startServe();
    deliverSigint();
    await h.state.closeCalled;
    expect(exitSpy.mock.calls).toEqual([]);
    deliverSigint();
    expect(exitSpy.mock.calls).toEqual([[YZJ_SERVE_EXIT_CODES.SIGINT]]);

    h.state.release();
    await serve;
  });

  it(`a second SIGTERM during shutdown exits ${YZJ_SERVE_EXIT_CODES.SIGTERM} at once`, async () => {
    const { serve, deliverSigterm } = await startServe();
    deliverSigterm();
    await h.state.closeCalled;
    expect(exitSpy.mock.calls).toEqual([]);
    deliverSigterm();
    expect(exitSpy.mock.calls).toEqual([[YZJ_SERVE_EXIT_CODES.SIGTERM]]);

    h.state.release();
    await serve;
  });

  // #150 review: a gateway cleanup step that fails must not skip the memory store close.
  it('a failing cleanup step (webhook server close) still closes the store, the write lands, and the error is rethrown', async () => {
    const realClose = Server.prototype.close;
    const closeSpy = vi.spyOn(Server.prototype, 'close').mockImplementation(function close(this: Server, callback?: (error?: Error) => void) {
      // The server really closes (no leaked handle); only the outcome reported to serve fails.
      return realClose.call(this, () => callback?.(new Error('injected webhook close failure')));
    } as typeof Server.prototype.close);
    try {
      const { serve, settled, deliverSigint } = await startServe(['--inbound-mode', 'webhook', '--webhook-port', '0', '--dry-run']);
      deliverSigint();

      // Fails if close() sits behind the cleanup steps: serve rejects before close is reached.
      expect(await Promise.race([settled, h.state.closeCalled])).toBe('close-called');
      h.state.release();
      await expect(serve).rejects.toThrow('injected webhook close failure');
      expect(closeSpy).toHaveBeenCalledTimes(1);
      // A failed shutdown is not reported as graceful.
      expect(exitSpy.mock.calls).toEqual([]);
      expect(readRawRow(join(base, 'config', 'memory.db'), LAST_MESSAGE)).toEqual({ session_id: 'yzj-session', role: 'user', content: LAST_MESSAGE });
    } finally {
      closeSpy.mockRestore();
    }
  });

  // #150 review: the probe env var is a test hook for --dry-run only; a real serve must ignore it.
  it('without --dry-run, XIAOK_YZJ_DRY_RUN_PROBE_WRITE writes nothing to memory.db', async () => {
    process.env.XIAOK_YZJ_DRY_RUN_PROBE_WRITE = LAST_MESSAGE;
    // Nothing here is meant to wait on segmentation; a probe write that slipped through must land so the check sees it.
    h.state.release();
    const { serve, deliverSigint } = await startServe(['--inbound-mode', 'webhook', '--webhook-port', '0'], { writeInFlight: false });
    deliverSigint();
    await serve;

    expect(h.state.adaptersCreated).toBe(1); // the non-dry-run path really ran
    expect(exitSpy.mock.calls).toEqual([[YZJ_SERVE_EXIT_CODES.graceful]]);
    expect(h.state.rawWriteSessions).not.toContain(PROBE_SESSION);
    expect(readProbeRows(join(base, 'config', 'memory.db'))).toEqual([]);
  });
});

describe('PidLock leaves signals to its owner (#150)', () => {
  it('acquire() installs no SIGINT/SIGTERM handler and releases the pid file on exit', () => {
    const pidFile = join(base, 'state', 'serve.pid');
    const sigint = process.listenerCount('SIGINT');
    const sigterm = process.listenerCount('SIGTERM');
    const exitBefore = new Set(process.listeners('exit'));
    const lock = new PidLock(pidFile);
    expect(lock.acquire()).toEqual({ acquired: true });
    try {
      expect(process.listenerCount('SIGINT')).toBe(sigint);
      expect(process.listenerCount('SIGTERM')).toBe(sigterm);
      const added = process.listeners('exit').filter((listener) => !exitBefore.has(listener));
      expect(added).toHaveLength(1);
      (added[0] as () => void)();
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      for (const listener of process.listeners('exit')) if (!exitBefore.has(listener)) process.off('exit', listener as () => void);
      lock.release();
    }
  });
});

// Real entry in a child process with real signals. POSIX only: on Windows, child.kill('SIGINT')
// terminates the child without running its handlers, so there is no signal shutdown to check.
// The in-process cases above cover the same shutdown on every platform.
describe.skipIf(process.platform === 'win32')('yzj serve child process with a real SIGINT (#150)', () => {
  const here = fileURLToPath(import.meta.url);
  const compiled = here.endsWith('.js');
  const entry = resolve(dirname(here), '../../src', compiled ? 'index.js' : 'index.ts');
  const preload = resolve(dirname(here), '../support', compiled ? 'yzj-serve-child-preload.js' : 'yzj-serve-child-preload.ts');
  const children = new Set<ChildProcess>();
  const EXIT_WITHIN_MS = 5_000;

  afterEach(async () => {
    // Never leave a child behind, also when an assertion failed mid-case.
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const gone = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGKILL');
        await gone;
      }
    }
    children.clear();
  });

  function startChild(gate: 'release-on-close' | 'hold', { leftoverHandle = false, signalDuringListen = false } = {}) {
    const child = spawn(process.execPath, [
      ...(compiled ? [] : ['--import', 'tsx']), '--import', pathToFileURL(preload).href, entry,
      ...SERVE_ARGS, '--inbound-mode', 'webhook', '--webhook-port', '0', '--dry-run',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: join(base, 'home'), USERPROFILE: join(base, 'home'), XIAOK_CONFIG_DIR: join(base, 'config'),
        XIAOK_YZJ_DRY_RUN_PROBE_WRITE: LAST_MESSAGE, XIAOK_TEST_YZJ_GATE: gate,
        XIAOK_TEST_YZJ_LEFTOVER_HANDLE: leftoverHandle ? '1' : '',
        XIAOK_TEST_YZJ_HOLD_LISTEN: signalDuringListen ? '1' : '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let output = '';
    const waiters: Array<() => void> = [];
    const onData = (chunk: Buffer) => { output += chunk.toString(); for (const check of waiters) check(); };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>((resolveExit) => {
      child.once('exit', (code, signal) => resolveExit({ code, signal, at: Date.now() }));
    });
    const waitForOutput = (text: string) => new Promise<void>((resolveWait, rejectWait) => {
      const check = () => { if (output.includes(text)) resolveWait(); };
      waiters.push(check);
      check();
      void exited.then(({ code, signal }) => rejectWait(new Error(`child exited (code=${code}, signal=${signal}) before "${text}":\n${output}`)));
    });
    /** The exit, or 'no-exit' if it has not happened within EXIT_WITHIN_MS (the time limit is the assertion). */
    const exitWithinLimit = () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<'no-exit'>((resolveLimit) => { timer = setTimeout(() => resolveLimit('no-exit'), EXIT_WITHIN_MS); });
      return Promise.race([exited, limit]).finally(() => clearTimeout(timer));
    };
    return { child, exitWithinLimit, waitForOutput, output: () => output };
  }

  /** The running child keeps its pid file under the temporary home, never under the real ~/.xiaok. */
  function expectPidFileInTempHome(child: ChildProcess) {
    const tempPid = join(base, 'home', '.xiaok', 'state', 'yzj', 'serve.pid');
    expect(existsSync(tempPid)).toBe(true);
    expect(readFileSync(tempPid, 'utf8').trim()).toBe(String(child.pid));
    const realPid = join(priorEnv.HOME ?? priorEnv.USERPROFILE ?? tmpdir(), '.xiaok', 'state', 'yzj', 'serve.pid');
    expect(existsSync(realPid) && readFileSync(realPid, 'utf8').trim() === String(child.pid)).toBe(false);
    return tempPid;
  }

  it('SIGINT with the last write in flight and a leftover handle: exits 0 within the limit and the row is in memory.db', async () => {
    // The leftover ref'd timer would keep the child alive forever if serve relied on the event loop draining.
    const run = startChild('release-on-close', { leftoverHandle: true });
    await run.waitForOutput('[yzj] gateway started');
    const tempPid = expectPidFileInTempHome(run.child);
    const signalledAt = Date.now();
    run.child.kill('SIGINT');
    const result = await run.exitWithinLimit();
    expect(result, run.output()).not.toBe('no-exit');
    expect({ code: (result as { code: number | null }).code, signal: (result as { signal: unknown }).signal }, run.output())
      .toEqual({ code: YZJ_SERVE_EXIT_CODES.graceful, signal: null });
    expect((result as { at: number }).at - signalledAt).toBeLessThan(EXIT_WITHIN_MS);
    expect(run.output()).toContain('[yzj-test] memory store close() started');
    expect(readRawRow(join(base, 'config', 'memory.db'), LAST_MESSAGE), run.output())
      .toEqual({ session_id: 'yzj-dry-run-probe', role: 'user', content: LAST_MESSAGE });
    expect(existsSync(tempPid)).toBe(false);
  }, 30_000);

  it(`a second SIGINT while shutdown waits on the write exits ${YZJ_SERVE_EXIT_CODES.SIGINT} at once`, async () => {
    const run = startChild('hold');
    await run.waitForOutput('[yzj] gateway started');
    const tempPid = expectPidFileInTempHome(run.child);
    run.child.kill('SIGINT');
    await run.waitForOutput('[yzj] shutting down (SIGINT)');
    const secondAt = Date.now();
    run.child.kill('SIGINT');
    const result = await run.exitWithinLimit();
    expect(result, run.output()).not.toBe('no-exit');
    expect({ code: (result as { code: number | null }).code, signal: (result as { signal: unknown }).signal }, run.output())
      .toEqual({ code: YZJ_SERVE_EXIT_CODES.SIGINT, signal: null });
    expect((result as { at: number }).at - secondAt).toBeLessThan(EXIT_WITHIN_MS);
    expect(run.output()).not.toContain('shutdown did not finish');
    expect(existsSync(tempPid)).toBe(false);
  }, 30_000);

  // #150 review: the signal handlers exist before the webhook listen await; a SIGINT that lands
  // there must still give the full graceful shutdown, not hang until the 15s forced exit (124).
  it('SIGINT while the webhook listen is still pending: exits 0, not 124, and the in-flight write is in memory.db', async () => {
    const run = startChild('release-on-close', { signalDuringListen: true });
    await run.waitForOutput('[yzj-test] webhook listen held until a signal');
    const tempPid = expectPidFileInTempHome(run.child);
    const signalledAt = Date.now();
    run.child.kill('SIGINT');
    const result = await run.exitWithinLimit();
    expect(result, run.output()).not.toBe('no-exit');
    expect({ code: (result as { code: number | null }).code, signal: (result as { signal: unknown }).signal }, run.output())
      .toEqual({ code: YZJ_SERVE_EXIT_CODES.graceful, signal: null });
    expect((result as { at: number }).at - signalledAt).toBeLessThan(EXIT_WITHIN_MS);
    // The signal really arrived during startup: shutdown began before the gateway reported started.
    const out = run.output();
    expect(out.indexOf('[yzj] shutting down (SIGINT)'), out).toBeGreaterThanOrEqual(0);
    expect(out.indexOf('[yzj] shutting down (SIGINT)'), out).toBeLessThan(out.indexOf('[yzj] gateway started'));
    expect(out).toContain('[yzj-test] memory store close() started');
    expect(out).not.toContain('shutdown did not finish');
    expect(readRawRow(join(base, 'config', 'memory.db'), LAST_MESSAGE), out)
      .toEqual({ session_id: 'yzj-dry-run-probe', role: 'user', content: LAST_MESSAGE });
    expect(existsSync(tempPid)).toBe(false);
  }, 30_000);
});
