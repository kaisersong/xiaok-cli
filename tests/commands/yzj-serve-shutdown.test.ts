import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
  const state = { home: '' } as {
    home: string;
    gate: Promise<void>; release: () => void;
    closeCalled: Promise<'close-called'>; notifyClose: () => void;
    storeCreated: Promise<MemoryStore>; notifyStore: (store: MemoryStore) => void;
  };
  const reset = () => {
    state.gate = new Promise<void>((resolve) => { state.release = resolve; });
    state.closeCalled = new Promise((resolve) => { state.notifyClose = () => resolve('close-called'); });
    state.storeCreated = new Promise((resolve) => { state.notifyStore = resolve; });
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
      h.state.notifyStore(store);
      return store;
    },
  };
});

import { registerYZJCommands, YZJ_SERVE_EXIT_CODES, YZJ_SHUTDOWN_FORCE_EXIT_MS } from '../../src/commands/yzj.js';

const LAST_MESSAGE = 'yzj 退出前最后一笔：南京市长江大桥';
const SERVE_ARGS = ['yzjchannel', 'serve', '--webhook-url', 'https://example.invalid/hook'];
const turn = () => new Promise<'still-waiting'>((resolve) => setImmediate(() => resolve('still-waiting')));

function readRawRow(dbPath: string, content: string): unknown {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare('SELECT session_id, role, content FROM memory_l0_raw WHERE content = ?').get(content);
  } finally {
    db.close();
  }
}

let base: string;
const priorEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XIAOK_CONFIG_DIR: process.env.XIAOK_CONFIG_DIR };
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

  /** Start serve, wait until it idles on its shutdown signal, put the last raw write in flight. */
  async function startServeWithWriteInFlight() {
    const program = new Command();
    program.exitOverride();
    registerYZJCommands(program);
    const serve = program.parseAsync(['node', 'xiaok', ...SERVE_ARGS, '--inbound-mode', 'websocket', '--no-webhook', '--dry-run']);
    running = serve;
    const settled = serve.then(() => 'serve-returned' as const);
    const store = await h.state.storeCreated;
    let added: Array<(signal: NodeJS.Signals) => void> = [];
    while (added.length === 0) {
      await turn();
      added = process.listeners('SIGINT').filter((listener) => !before.SIGINT.has(listener)) as typeof added;
    }
    // Same call agent-runtime makes for the last user message: not awaited.
    void store.writeRawMessage!('yzj-session', 'user', LAST_MESSAGE);
    // Every SIGINT listener added since the start, in registration order, as Node delivers it.
    const deliverSigint = () => {
      for (const listener of process.listeners('SIGINT')) if (!before.SIGINT.has(listener)) (listener as (s: NodeJS.Signals) => void)('SIGINT');
    };
    return { serve, settled, deliverSigint };
  }

  it('SIGINT waits for the in-flight write, exits 0, and the row is in memory.db after reopening', async () => {
    const { serve, settled, deliverSigint } = await startServeWithWriteInFlight();
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
    const { serve, deliverSigint } = await startServeWithWriteInFlight();
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
    const { serve, deliverSigint } = await startServeWithWriteInFlight();
    deliverSigint();
    await h.state.closeCalled;
    expect(exitSpy.mock.calls).toEqual([]);
    deliverSigint();
    expect(exitSpy.mock.calls).toEqual([[YZJ_SERVE_EXIT_CODES.SIGINT]]);

    h.state.release();
    await serve;
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

  function startChild(gate: 'release-on-close' | 'hold', leftoverHandle = false) {
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

  it('SIGINT with the last write in flight and a leftover handle: exits 0 within the limit and the row is in memory.db', async () => {
    // The leftover ref'd timer would keep the child alive forever if serve relied on the event loop draining.
    const run = startChild('release-on-close', true);
    await run.waitForOutput('[yzj] gateway started');
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
  }, 30_000);

  it(`a second SIGINT while shutdown waits on the write exits ${YZJ_SERVE_EXIT_CODES.SIGINT} at once`, async () => {
    const run = startChild('hold');
    await run.waitForOutput('[yzj] gateway started');
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
  }, 30_000);
});
