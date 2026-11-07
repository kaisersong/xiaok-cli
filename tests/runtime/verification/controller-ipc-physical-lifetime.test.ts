import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import { callControllerIpc, startControllerIpc, readOriginalControllerIpcPhysicalFate } from '../../../src/runtime/verification/controller-ipc.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function turns() { await tick(); await tick(); }

function observe(raw: Promise<Buffer>) {
  const row: { settled: boolean; rejected: boolean; value?: Buffer; reason?: unknown } = {
    settled: false, rejected: false,
  };
  const done = raw.then(value => {
    row.value = value; row.settled = true;
  }, reason => {
    row.reason = reason; row.rejected = true; row.settled = true;
  });
  return { row, done };
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'controller-ipc-physical-'));
  const socketPath = process.platform === 'win32'
    ? '\\\\.\\pipe\\xiaok-ipc-physical-' + randomUUID()
    : join(root, 's');
  let dispatches = 0;
  const server = await startControllerIpc({ socketPath, async dispatch(body) {
    dispatches++; return Buffer.from('ok:' + body.toString());
  } });
  return { socketPath, dispatches: () => dispatches, async close() {
    await server.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } };
}

it('does not deliver a framed result before the actual client Socket close event', async () => {
  const f = await fixture();
  let closeObserved = false, closedAtDelivery: boolean | undefined;
  const raw = callControllerIpc(f.socketPath, Buffer.from('request'), {
    verifyServerPeer(socket) {
      socket.once('close', () => { closeObserved = true; });
    },
  });
  const observed = observe(raw.then(value => {
    closedAtDelivery = closeObserved; return value;
  }));
  try {
    await observed.done;
    expect(observed.row.value?.toString()).toBe('ok:request');
    expect(closedAtDelivery).toBe(true);
  } finally { await f.close(); }
});

it('retains an original Socket own-symbol Promise through physical close', async () => {
  const f = await fixture(), tail = deferred<void>(), closed = deferred<void>();
  const sidecar = Symbol('original socket SDK tail');
  const observed = observe(callControllerIpc(f.socketPath, Buffer.from('request'), {
    verifyServerPeer(socket) {
      Object.defineProperty(socket, sidecar, { value: tail.promise });
      socket.once('close', () => closed.resolve());
    },
  }));
  try {
    await closed.promise; await turns();
    expect(observed.row.settled).toBe(false);
  } finally {
    tail.resolve(); await observed.done; await f.close();
  }
  expect(observed.row.value?.toString()).toBe('ok:request');
});

it('retains the actual Socket.write raw Promise and newly exposed outcome tail', async () => {
  const f = await fixture(), inner = deferred<void>(), raw = deferred<object>();
  const wrote = deferred<void>(), closed = deferred<void>();
  const observed = observe(callControllerIpc(f.socketPath, Buffer.from('request'), {
    verifyServerPeer(socket) {
      const write = socket.write;
      socket.write = function(this: Socket, ...args: unknown[]) {
        Reflect.apply(write, this, args); wrote.resolve(); return raw.promise;
      } as unknown as Socket['write'];
      socket.once('close', () => closed.resolve());
    },
  }));
  try {
    await wrote.promise; await closed.promise;
    raw.resolve({ [Symbol('outcome SDK tail')]: inner.promise });
    await turns();
    expect(observed.row.settled).toBe(false);
  } finally {
    raw.resolve({}); inner.resolve(); await observed.done; await f.close();
  }
  expect(observed.row.value?.toString()).toBe('ok:request');
});

it('preserves the exact peer Error and waits its own data and symbol SDK tails', async () => {
  const f = await fixture(), stack = deferred<void>(), tail = deferred<void>();
  const peerEntered = deferred<void>(), error = new Error('original peer failure');
  Object.defineProperty(error, 'stack', { value: stack.promise });
  Object.defineProperty(error, Symbol('error SDK tail'), { value: tail.promise });
  const observed = observe(callControllerIpc(f.socketPath, Buffer.from('secret'), {
    verifyServerPeer() { peerEntered.resolve(); throw error; },
  }));
  try {
    await peerEntered.promise; await turns();
    expect(f.dispatches()).toBe(0);
    expect(observed.row.settled).toBe(false);
  } finally {
    stack.resolve(); tail.resolve(); await observed.done; await f.close();
  }
  expect(observed.row.rejected).toBe(true);
  expect(observed.row.reason).toBe(error);
});

it('preserves a thrown undefined peer failure by presence rather than replacing its value', async () => {
  const f = await fixture();
  const observed = observe(callControllerIpc(f.socketPath, Buffer.from('secret'), {
    verifyServerPeer() { throw undefined; },
  }));
  try {
    await observed.done;
    expect(f.dispatches()).toBe(0);
    expect(observed.row.rejected).toBe(true);
    expect(observed.row.reason).toBeUndefined();
  } finally { await f.close(); }
});

it('joins the actual aborted Socket and its visible SDK tail before rejection', async () => {
  const f = await fixture(), tail = deferred<void>(), closed = deferred<void>();
  const control = new AbortController();
  const observed = observe(callControllerIpc(f.socketPath, Buffer.from('secret'), {
    signal: control.signal,
    verifyServerPeer(socket) {
      Object.defineProperty(socket, Symbol('abort tail'), { value: tail.promise });
      socket.once('close', () => closed.resolve());
      control.abort();
    },
  }));
  try {
    await closed.promise; await turns();
    expect(f.dispatches()).toBe(0);
    expect(observed.row.settled).toBe(false);
  } finally {
    tail.resolve(); await observed.done; await f.close();
  }
  expect(observed.row.rejected).toBe(true);
  expect((observed.row.reason as Error).message).toBe('controller_ipc_aborted_unknown');
});

it('retains a nonvoid peer callback original Promise and its rejected Error symbol tail', async () => {
  const f = await fixture(), returned = deferred<never>(), tail = deferred<void>();
  const peerEntered = deferred<void>(), error = new Error('async peer failure');
  Object.defineProperty(error, Symbol('late rejection SDK tail'), { value: tail.promise });
  const observed = observe(callControllerIpc(f.socketPath, Buffer.from('secret'), {
    verifyServerPeer: (() => { peerEntered.resolve(); return returned.promise; }) as unknown as (socket: Socket) => void,
  }));
  try {
    await peerEntered.promise; returned.reject(error); await turns();
    expect(f.dispatches()).toBe(0);
    expect(observed.row.settled).toBe(false);
  } finally {
    returned.reject(error); tail.resolve();
    await observed.done; await f.close();
  }
  expect(observed.row.rejected).toBe(true);
  expect((observed.row.reason as Error).message).toBe('controller_server_peer_sync_void');
});

it('rechecks synchronous peer callback abort before any original Socket.write', async () => {
  const f = await fixture(), control = new AbortController();
  let writes = 0, peers = 0;
  const observed = observe(callControllerIpc(f.socketPath, Buffer.from('secret'), {
    signal: control.signal,
    verifyServerPeer(socket) {
      peers++;
      const write = socket.write;
      socket.write = function(this: Socket, ...args: unknown[]) {
        writes++; return Reflect.apply(write, this, args);
      } as Socket['write'];
      control.abort();
    },
  }));
  try {
    await observed.done;
    expect(peers).toBe(1); expect(writes).toBe(0); expect(f.dispatches()).toBe(0);
    expect(observed.row.rejected).toBe(true);
  } finally { await f.close(); }
});

async function childFault(scenario: 'entered_no_handle' | 'cleanup_attempt_all' | 'listen_sync_throw' | 'timer_no_handle') {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const child = spawn(process.execPath, ['--import', 'tsx',
    fileURLToPath(new URL('./fixtures/controller-ipc-fault-child.mjs', import.meta.url)), scenario],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout!.on('data', bytes => { stdout += String(bytes); });
  child.stderr!.on('data', bytes => { stderr += String(bytes); });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  expect(result, stderr).toEqual({ code: 0, signal: null });
  const facts = JSON.parse(stdout.trim());
  console.log(JSON.stringify({ originalIpcFault: facts }));
  return facts;
}

it('retains entered createConnection with no returned handle as physical unknown', async () => {
  const facts = await childFault('entered_no_handle');
  expect(facts.entered).toBe(true); expect(facts.actualSocketBorn).toBe(true);
  expect(facts.rejected).toBe(true); expect(facts.exactPrimary).toBe(true);
  expect(facts.dispatches).toBe(0);
  expect(facts.hasFateReader).toBe(true);
  expect(facts.physicalKnown).toBe(false);
});

it('attempts Socket cleanup after abort-listener cleanup throws and preserves the first peer failure', async () => {
  const facts = await childFault('cleanup_attempt_all');
  expect(facts.peerCalls).toBe(1); expect(facts.dispatches).toBe(0);
  expect(facts.uncaught).toEqual([]);
  expect(facts.beforeManualCleanup.productDestroyCalls).toBeGreaterThan(0);
  expect(facts.rejected).toBe(true); expect(facts.exactPrimary).toBe(true);
  expect(facts.closeObserved).toBe(true);
});


it('keeps a peer-added transient Socket accessor unknown after it is removed without invoking its getter', async () => {
  const f = await fixture();
  let getters = 0;
  const raw = callControllerIpc(f.socketPath, Buffer.from('secret'), {
    verifyServerPeer(socket) {
      Object.defineProperty(socket, 'transientIpcAccessor', {
        configurable: true, get() { getters++; return 1; },
      });
      queueMicrotask(() => { Reflect.deleteProperty(socket, 'transientIpcAccessor'); });
    },
  });
  const observed = observe(raw);
  try {
    await observed.done;
    expect(getters).toBe(0);
    expect(observed.row.rejected).toBe(true);
    expect(() => readOriginalControllerIpcPhysicalFate(raw).assertKnown()).toThrow();
  } finally { await f.close(); }
});

it('retains an actual abort callback Event own-symbol tail before negative physical completion', async () => {
  const f = await fixture(), control = new AbortController(), tail = deferred<void>();
  const eventEntered = deferred<void>();
  const add = control.signal.addEventListener;
  control.signal.addEventListener = function(this: AbortSignal, ...args: Parameters<AbortSignal['addEventListener']>) {
    const [type, listener, options] = args;
    return Reflect.apply(add, this, [type, (event: Event) => {
      Object.defineProperty(event, Symbol('actual abort SDK Event tail'), { value: tail.promise });
      eventEntered.resolve();
      if (typeof listener === 'function') listener.call(this, event);
      else listener?.handleEvent(event);
    }, options]);
  };
  const raw = callControllerIpc(f.socketPath, Buffer.from('secret'), {
    signal: control.signal, verifyServerPeer() { control.abort(); },
  });
  const observed = observe(raw);
  try {
    await eventEntered.promise; await turns();
    expect(observed.row.settled).toBe(false);
  } finally {
    tail.resolve(); await observed.done; delete (control.signal as any).addEventListener;
    await f.close();
  }
  expect(observed.row.rejected).toBe(true);
});

it('keeps private fate tied to the exact original raw call and refuses copies, derived promises and proxies without traps', async () => {
  const f = await fixture();
  const raw = callControllerIpc(f.socketPath, Buffer.from('request'));
  let traps = 0;
  const proxy = new Proxy(raw, {
    get() { traps++; throw Error('getter'); },
    ownKeys() { traps++; throw Error('ownKeys'); },
    getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); },
  });
  try {
    for (const foreign of [{}, Promise.resolve(), raw.then(value => value), proxy])
      expect(() => readOriginalControllerIpcPhysicalFate(foreign)).toThrow('controller_ipc_physical_unknown');
    const fate = readOriginalControllerIpcPhysicalFate(raw);
    expect(() => fate.assertKnown()).toThrow();
    expect((await raw).toString()).toBe('ok:request');
    await fate.waitKnown(); expect(() => fate.assertKnown()).not.toThrow();
    expect(traps).toBe(0);
  } finally { await f.close(); }
});

it('does not evaluate a late Socket.write accessor installed across the peer callback await boundary', async () => {
  const f = await fixture();
  let getters = 0;
  const raw = callControllerIpc(f.socketPath, Buffer.from('secret'), {
    verifyServerPeer(socket) {
      queueMicrotask(() => Object.defineProperty(socket, 'write', {
        get() { getters++; throw Error('late write getter'); },
      }));
    },
  });
  const observed = observe(raw);
  try {
    await observed.done;
    expect(observed.row.rejected).toBe(true);
    expect(getters).toBe(0); expect(f.dispatches()).toBe(0);
    expect(() => readOriginalControllerIpcPhysicalFate(raw).assertKnown()).toThrow();
  } finally { await f.close(); }
});

it('reads original fate without touching caller-mutated metadata on the exact returned Promise', async () => {
  const f = await fixture();
  const raw = callControllerIpc(f.socketPath, Buffer.from('request'));
  const fate = readOriginalControllerIpcPhysicalFate(raw);
  try {
    await raw;
    let getters = 0;
    Object.defineProperty(raw, 'constructor', { configurable: true, get() { getters++; return Promise; } });
    await fate.waitKnown();
    expect(getters).toBe(0);
    expect(() => fate.assertKnown()).not.toThrow();
  } finally { await f.close(); }
});


it('consumes every internal setup continuation rejection when actual listener registration throws', async () => {
  const facts = await childFault('listen_sync_throw');
  expect(facts.actualSocketBorn).toBe(true);
  expect(facts.rejected).toBe(true); expect(facts.exactPrimary).toBe(true);
  expect(facts.uncaught).toEqual([]); expect(facts.unhandled).toEqual([]);
  expect(facts.closeObserved).toBe(true);
});

it('retains an entered Timer constructor that created a real timer but returned no handle as physical unknown', async () => {
  const facts = await childFault('timer_no_handle');
  expect(facts.timerEntered).toBe(1); expect(facts.timerBorn).toBe(true);
  expect(facts.rejected).toBe(true); expect(facts.exactPrimary).toBe(true);
  expect(facts.physicalKnownAfterCompletion).toBe(false);
  expect(facts.uncaught).toEqual([]); expect(facts.unhandled).toEqual([]);
});

it('joins a sealed Socket SDK callback original Buffer symbol tail after real destroy and close', async () => {
  const f = await fixture(), tail = deferred<void>(), closed = deferred<void>();
  let originalChunk: Buffer | undefined, injected = 0;
  const raw = callControllerIpc(f.socketPath, Buffer.from('request'), {
    verifyServerPeer(socket) {
      socket.prependListener('data', chunk => { originalChunk = chunk; });
      socket.once('close', () => closed.resolve());
      const destroy = socket.destroy;
      socket.destroy = function(this: Socket, ...args: unknown[]) {
        const value = Reflect.apply(destroy, this, args);
        if (originalChunk && !injected++) {
          Object.defineProperty(originalChunk, Symbol('late actual SDK callback data tail'), { value: tail.promise });
          this.emit('data', originalChunk);
        }
        return value;
      } as Socket['destroy'];
    },
  });
  const observed = observe(raw);
  try {
    await closed.promise; await turns();
    expect(originalChunk).toBeDefined(); expect(injected).toBe(1);
    expect(observed.row.settled).toBe(false);
    expect(() => readOriginalControllerIpcPhysicalFate(raw).assertKnown()).toThrow();
  } finally { tail.resolve(); await observed.done; await f.close(); }
  expect(observed.row.value?.toString()).toBe('ok:request');
});


it.skipIf(process.platform === 'win32')('captures real immediate ENOENT and ECONNREFUSED before async acquisition can miss error or close', async () => {
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'controller-ipc-immediate-'));
  const stale = join(root, 'stale');
  const child = spawnSync(process.execPath, ['-e',
    "require('node:net').createServer().listen(process.argv[1],()=>process.exit(0))", stale],
  { encoding: 'utf8' });
  try {
    expect(child.status, child.stderr).toBe(0); expect(child.signal).toBeNull();
    expect(lstatSync(stale).isSocket()).toBe(true);
    for (const [path, code] of [[join(root, 'missing'), 'ENOENT'], [stale, 'ECONNREFUSED']]) {
      const raw = callControllerIpc(path!, Buffer.from('request'), { timeoutMs: 500 });
      await expect(raw).rejects.toMatchObject({ code });
      const fate = readOriginalControllerIpcPhysicalFate(raw);
      await fate.waitKnown(); expect(() => fate.assertKnown()).not.toThrow();
    }
    console.log(JSON.stringify({ originalImmediateIpcErrors: {
      nodeVersion: process.versions.node, fixtureChild: { pid: child.pid, status: child.status, signal: child.signal },
      originalErrorCodes: ['ENOENT', 'ECONNREFUSED'],
    } }));
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});
