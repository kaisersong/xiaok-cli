import {afterAll, afterEach, beforeEach, expect, it, vi} from 'vitest';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const faults = vi.hoisted(() => ({
  home: '', route: 'ordinary', calls: 0, closes: 0, traps: 0,
  currentHook: undefined as undefined | (() => void),
  postFault: '', postCommand: 'activate', constructorAfter: false, terminateBefore: false, raw: undefined as unknown,
  holdTerminate: undefined as undefined | Promise<void>,
  tail: undefined as undefined | Promise<void>, unknownFirst: false,
  workers: [] as import('node:worker_threads').Worker[],
  messages: [] as unknown[], rawReturns: [] as Promise<number>[],
}));
vi.mock('node:os', async load => {
  const actual = await load<typeof import('node:os')>();
  return {...actual, userInfo: () => ({...actual.userInfo(), homedir: faults.home})};
});
vi.mock('../../../src/runtime/verification/migration-markers.js', async load => ({
  ...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),
  readInstalledCurrentProfile: () => { faults.currentHook?.(); return {kind: faults.route}; },
}));
vi.mock('node:worker_threads', async load => {
  const actual = await load<typeof import('node:worker_threads')>();
  class ObservedWorker extends actual.Worker {
    constructor(...args: ConstructorParameters<typeof actual.Worker>) {
      faults.calls++;
      super(...args);
      faults.workers.push(this);
      if (faults.constructorAfter) throw faults.raw;
    }
    postMessage(message: any, ...rest: any[]) {
      faults.messages.push(message);
      if (message.command === faults.postCommand && faults.postFault === 'before') throw faults.raw;
      const result = Reflect.apply(actual.Worker.prototype.postMessage, this, [message, ...rest]);
      if (message.command === faults.postCommand && faults.postFault === 'after') throw faults.raw;
      return result;
    }
    terminate(): Promise<number> {
      faults.closes++;
      if (faults.terminateBefore) throw faults.raw;
      const close = () => Reflect.apply(actual.Worker.prototype.terminate, this, []) as Promise<number>;
      const raw = faults.holdTerminate ? faults.holdTerminate.then(close) : close();
      faults.rawReturns.push(raw);
      if (faults.tail) Object.defineProperty(raw, Symbol('known-original-terminate-tail'), {value: faults.tail});
      if (faults.unknownFirst && faults.workers.indexOf(this) === 0) {
        Object.defineProperty(raw, Symbol('unconfirmed-sdk-slot'), {get() { faults.traps++; throw Error('must not read SDK getter'); }});
      }
      return raw;
    }
  }
  return {...actual, Worker: ObservedWorker};
});
const actual = await vi.importActual<typeof import('node:worker_threads')>('node:worker_threads');
const rawTerminate = actual.Worker.prototype.terminate, rawPost = actual.Worker.prototype.postMessage;
const threadId = Object.getOwnPropertyDescriptor(actual.Worker.prototype, 'threadId')!.get!;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'budget-retirement-')));
const oldConfig = process.env.XIAOK_CONFIG_DIR;
let serial = 0, retainedUnknownRoot = false;
const stores: any[] = [];
const expectedUnknown = new Set<object>();
beforeEach(() => {
  vi.resetModules();
  faults.home = join(root, 'account-' + serial++);
  mkdirSync(faults.home, {mode: 0o700});
  process.env.XIAOK_CONFIG_DIR = join(faults.home, '.xiaok');
  faults.route = 'ordinary'; faults.calls = 0; faults.closes = 0; faults.traps = 0;
  faults.postFault = ''; faults.postCommand = 'activate'; faults.constructorAfter = false; faults.terminateBefore = false; faults.raw = undefined; faults.currentHook = undefined;
  faults.holdTerminate = undefined; faults.tail = undefined; faults.unknownFirst = false;
  faults.workers = []; faults.messages = []; faults.rawReturns = [];
});
afterEach(async () => {
  faults.currentHook = undefined; faults.postFault = ''; faults.route = 'ordinary'; faults.terminateBefore = false; faults.constructorAfter = false;
  const errors: unknown[] = [];
  for (const store of stores.splice(0)) {
    try { await store.dispose(); } catch (raw) { if (!expectedUnknown.has(store)) errors.push(raw); }
  }
  for (const worker of faults.workers) {
    try { await Reflect.apply(rawTerminate, worker, []); } catch (raw) { errors.push(raw); }
  }
  await Promise.allSettled(faults.rawReturns);
  expectedUnknown.clear();
  if (errors.length) throw new AggregateError(errors, 'retirement fixture cleanup');
});
afterAll(() => {
  if (oldConfig === undefined) delete process.env.XIAOK_CONFIG_DIR;
  else process.env.XIAOK_CONFIG_DIR = oldConfig;
  if (!retainedUnknownRoot) rmSync(root, {recursive: true, force: true, maxRetries: 5});
  else console.log(JSON.stringify({kind: 'retirement-owner-lock-unknown-root-retained', root, pid: process.pid}));
});
async function data(label = 'db') {
  const module = await import('../../../desktop/electron/harness-optimization-config.js');
  const directory = join(faults.home, label);
  mkdirSync(directory);
  const identity = statSync(directory, {bigint: true});
  return {
    dbPath: join(directory, 'harness-optimization.sqlite'), root: directory,
    identity: `${identity.dev}:${identity.ino}`, ownerId: 'original-owner', initOperationId: 'original-init',
    initializing: true, now: 1000, defaultConfig: structuredClone(module.DEFAULT_HARNESS_OPTIMIZATION_CONFIG),
    profileId: 'original-profile', workspaceId: 'original-workspace',
  };
}
async function open(label = 'db') {
  const api = await import('../../../desktop/electron/harness-optimization-store.js');
  const input = await data(label), store = new api.HarnessOptimizationStore(input, () => {});
  stores.push(store); await store.ready;
  return {api, input, store, worker: faults.workers[faults.workers.length - 1]!};
}
function deferred() {
  let release!: () => void;
  return {promise: new Promise<void>(yes => {release = yes;}), release: () => release()};
}
function command(worker: import('node:worker_threads').Worker, name: string, id: number) {
  return new Promise<any>((yes, no) => {
    const message = (value: any) => { if (value.id === id) { worker.off('message', message); yes(value); } };
    worker.on('message', message);
    try { Reflect.apply(rawPost, worker, [{id, command: name, payload: {dirty: false}}]); }
    catch (raw) { worker.off('message', message); no(raw); }
  });
}
it.each(['protected', 'unavailable'])('retires the actual Store and new births permanently after route %s', async route => {
  const f = await open(); await f.store.call('activate', {dirty: false});
  faults.route = route;
  const first = await f.store.call('activate', {dirty: false}).then(() => ({ok: true, raw: undefined}), (raw: unknown) => ({ok: false, raw}));
  expect(first.ok).toBe(false);
  expect(first.raw).toBeInstanceOf(Error);
  expect((first.raw as Error).message).toBe('budget_source_writer_retired');
  expect((first.raw as Error).cause).toBeInstanceOf(Error);
  expect(((first.raw as Error).cause as Error).message).toBe('ordinary_source_route');
  faults.route = 'ordinary';
  await expect(f.store.call('read')).rejects.toBe(first.raw);
  expect(() => new f.api.HarnessOptimizationStore(f.input, () => {})).toThrow(first.raw as Error);
  const next = await data('another-db');
  expect(() => new f.api.HarnessOptimizationStore(next, () => {})).toThrow(first.raw as Error);
  expect(faults.calls).toBe(1);
});
it('fences a raw original Worker command while terminate is genuinely pending, then waits actual exit', async () => {
  const f = await open(); await f.store.call('activate', {dirty: false});
  const held = deferred(); faults.holdTerminate = held.promise; faults.route = 'protected';
  try {
    const first = await f.store.call('read').then(() => ({ok: true}), raw => ({ok: false, raw}));
    for (const [index, name] of ['activate', 'read', 'reset_clock', 'dsh_open_account', 'dsh_settle_attempt'].entries()) {
      const reply = await command(f.worker, name, 9001 + index);
      expect(reply.error).toBe('budget_source_writer_retired');
    }
    expect(first.ok).toBe(false);
    expect(() => f.api.readOriginalHarnessBudgetStoreWriterFate(f.store).assertTerminated()).toThrow('budget_source_physical_unconfirmed');
  } finally { held.release(); }
  await f.store.dispose();
  expect(() => f.api.readOriginalHarnessBudgetStoreWriterFate(f.store).assertTerminated()).not.toThrow();
  const db = new DatabaseSync(f.input.dbPath, {readOnly: true});
  try { expect(db.prepare("SELECT value FROM metadata WHERE key='epoch'").get()).toEqual({value: '1'}); }
  finally { db.close(); }
});
it('keeps every live original birth in the cut and joins a known tail despite another unknown SDK slot', async () => {
  const first = await open('a'), second = await open('b');
  expectedUnknown.add(first.store);
  const held = deferred(); faults.tail = held.promise; faults.unknownFirst = true; faults.route = 'protected';
  const source = await import('../../../desktop/electron/harness-budget-source-lifecycle.js');
  let settled = false;
  try {
    await first.store.call('read').catch(() => {});
    const view = (source as any).readOriginalBudgetSourcePopulationFate();
    const operation = view.wait().then(() => {settled = true; return null;}, (raw: unknown) => {settled = true; return raw;});
    await vi.waitFor(() => expect(faults.closes).toBe(2));
    expect(settled).toBe(false); expect(faults.traps).toBe(0);
    expect(() => view.assertPhysicallyKnown()).toThrow();
    held.release(); await operation;
    expect(() => view.assertPhysicallyKnown()).toThrow();
    expect(() => second.api.readOriginalHarnessBudgetStoreWriterFate(second.store).assertTerminated()).not.toThrow();
  } finally { held.release(); }
});
it('rechecks the local gate after a genuine Source callback synchronously disposes the Store', async () => {
  const f = await open(); let disposing: Promise<void> | undefined;
  faults.currentHook = () => { faults.currentHook = undefined; disposing = f.store.dispose(); };
  const result = await f.store.call('activate', {dirty: false}).then(() => ({ok: true}), raw => ({ok: false, raw}));
  expect(result.ok).toBe(false); expect(disposing).toBeDefined();
  expect(faults.messages.filter((message: any) => message.command === 'activate')).toHaveLength(0);
  await disposing;
});
it('rejects caller preloaded revocation data without constructing any Worker or evaluating a getter', async () => {
  const api = await import('../../../desktop/electron/harness-optimization-store.js'), input = await data();
  let touched = 0;
  Object.defineProperty(input, 'originalOrdinaryBudgetRetirement', {enumerable: true, get() {touched++; return new SharedArrayBuffer(4);}});
  expect(() => {
    const born = new api.HarnessOptimizationStore(input, () => {});
    stores.push(born); void born.ready.catch(() => {});
  }).toThrow('budget_source_private_latch');
  expect(touched).toBe(0); expect(faults.calls).toBe(0); expect(existsSync(input.dbPath)).toBe(false);
});
it.each(['before', 'after'])('preserves postMessage %s bare undefined and prevents a fresh command or replacement birth', async phase => {
  const f = await open(); faults.postFault = phase;
  const result = await f.store.call('activate', {dirty: false}).then(() => ({rejected: false, raw: null}), raw => ({rejected: true, raw}));
  expect(result).toEqual({rejected: true, raw: undefined});
  faults.postFault = '';
  const next = await f.store.call('read').then(() => ({ok: true, raw: undefined}), raw => ({ok: false, raw}));
  expect(next.ok).toBe(false);
  expect((next.raw as Error).message).toBe('budget_source_writer_retired');
  expect(Object.getOwnPropertyDescriptor(next.raw, 'cause')).toHaveProperty('value', undefined);
  expect(() => new f.api.HarnessOptimizationStore(f.input, () => {})).toThrow('budget_source_writer_retired');
});

function competingNativeLock(directory: string) {
  const binary = resolve('native/harness-optimization-owner-lock/build/Release/harness_owner_lock.node');
  const source = `const addon=require(process.argv[1]);let value;try{value=addon.acquire(process.argv[2]);console.log(JSON.stringify({acquired:true}));addon.release(value);}catch(error){console.log(JSON.stringify({acquired:false,message:error.message}));}`;
  const child = spawnSync(process.execPath, ['-e', source, binary, join(directory, 'harness-optimization.owner.lock')], {encoding: 'utf8', timeout: 5000});
  console.log(JSON.stringify({kind: 'owned-budget-lock-contender', pid: child.pid, status: child.status, stdout: child.stdout, stderr: child.stderr}));
  expect(child.status).toBe(0); return JSON.parse(child.stdout);
}
it.skipIf(process.platform !== 'darwin')('keeps the same original Native owner lock after an after-constructor failure with a real unclosed Worker', async () => {
  const service = await import('../../../desktop/electron/harness-optimization-service.js');
  const directory = join(faults.home, 'runtime');
  faults.constructorAfter = true; retainedUnknownRoot = true;
  const runtime = await service.createHarnessOptimizationRuntime({dataRoot: directory, profileId: 'p', workspaceId: 'w', authorizeUser: () => false, manifestLookup: () => undefined, now: () => 1000});
  expect(await runtime.api.read()).toMatchObject({status: 'unavailable'});
  expect(faults.workers).toHaveLength(1);
  const actualThread = Reflect.apply(threadId, faults.workers[0], []);
  console.log(JSON.stringify({kind: 'live-original-budget-worker', parentPid: process.pid, threadId: actualThread}));
  expect(actualThread).toBeGreaterThan(0);
  const outcome = competingNativeLock(directory);
  expect(outcome).toEqual({acquired: false, message: 'owner_lock_busy'});
});
it.skipIf(process.platform !== 'darwin')('keeps the original Native owner lock when shutdown post and terminate both fail before their real SDK effect', async () => {
  const service = await import('../../../desktop/electron/harness-optimization-service.js');
  const directory = join(faults.home, 'runtime');
  const runtime = await service.createHarnessOptimizationRuntime({dataRoot: directory, profileId: 'p', workspaceId: 'w', authorizeUser: () => false, manifestLookup: () => undefined, now: () => 1000});
  expect(await runtime.api.read()).toMatchObject({status: 'ready'});
  faults.postFault = 'before'; faults.postCommand = 'shutdown'; faults.terminateBefore = true; retainedUnknownRoot = true;
  const result = await runtime.dispose().then(() => ({rejected: false, raw: null}), raw => ({rejected: true, raw}));
  expect(result).toEqual({rejected: true, raw: undefined});
  expect(faults.closes).toBe(1);
  const actualThread = Reflect.apply(threadId, faults.workers[0], []);
  console.log(JSON.stringify({kind: 'live-original-budget-worker', parentPid: process.pid, threadId: actualThread}));
  expect(actualThread).toBeGreaterThan(0);
  const outcome = competingNativeLock(directory);
  expect(outcome).toEqual({acquired: false, message: 'owner_lock_busy'});
});

it.skipIf(process.platform !== 'darwin')('releases the original Native owner lock after a normal actual Worker shutdown and exit', async () => {
  const service = await import('../../../desktop/electron/harness-optimization-service.js');
  const directory = join(faults.home, 'runtime');
  const runtime = await service.createHarnessOptimizationRuntime({dataRoot: directory, profileId: 'p', workspaceId: 'w', authorizeUser: () => false, manifestLookup: () => undefined, now: () => 1000});
  expect(await runtime.api.read()).toMatchObject({status: 'ready'});
  expect(competingNativeLock(directory)).toEqual({acquired: false, message: 'owner_lock_busy'});
  await runtime.dispose();
  expect(Reflect.apply(threadId, faults.workers[0], [])).toBe(-1);
  expect(competingNativeLock(directory)).toEqual({acquired: true});
});
it.skipIf(process.platform !== 'darwin')('binds a real alias to the original physical Native owner root and defers a requested release until exit', async () => {
  const owner = await import('../../../desktop/electron/harness-optimization-owner-lock.js');
  const api = await import('../../../desktop/electron/harness-optimization-store.js');
  const input = await data();
  const lock = owner.acquireHarnessOwnerLock(input.root);
  const alias = input.dbPath.startsWith('/private/var/') ? input.dbPath.slice('/private'.length) : input.dbPath;
  const store = new api.HarnessOptimizationStore({...input, dbPath: alias}, () => {});
  stores.push(store);
  const held = deferred();
  try {
    await store.ready;
    lock.release();
    expect(lock.held()).toBe(true);
    expect(() => owner.readOriginalHarnessOwnerLock(lock)).toThrow('owner_lock_release_pending');
    expect(competingNativeLock(input.root)).toEqual({acquired: false, message: 'owner_lock_busy'});
    faults.holdTerminate = held.promise;
    const closing = store.dispose();
    expect(lock.held()).toBe(true);
    held.release();
    await closing;
    expect(lock.held()).toBe(false);
    expect(competingNativeLock(input.root)).toEqual({acquired: true});
  } finally {held.release(); lock.release();}
});

it('keeps retirement sticky when the original failure callback synchronously requests its Store close', async () => {
  const api = await import('../../../desktop/electron/harness-optimization-store.js');
  const input = await data();
  let store: InstanceType<typeof api.HarnessOptimizationStore>;
  let closing: Promise<void> | undefined;
  store = new api.HarnessOptimizationStore(input, () => {closing = store.dispose();});
  stores.push(store);
  await store.ready;
  faults.route = 'protected';
  const first = await store.call('read').then(() => {throw Error('expected retirement');}, raw => raw);
  expect(first).toBeInstanceOf(Error);
  expect(first.message).toBe('budget_source_writer_retired');
  expect(closing).toBeDefined();
  await closing;
  expect(() => api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).not.toThrow();
  faults.route = 'ordinary';
  await expect(store.call('activate', {dirty: false})).rejects.toBe(first);
  expect(faults.closes).toBe(1);
});
