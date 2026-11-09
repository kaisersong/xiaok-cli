import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { types } from 'node:util';

const controls = vi.hoisted(() => ({
  mode: 'normal' as 'normal' | 'reject-undefined' | 'throw-undefined' | 'unknown',
  readArmed: false,
  readAttached: false,
  readTail: undefined as Promise<void> | undefined,
  readReady: () => {},
  writeArmed: false,
  writeAttached: false,
  writeTail: undefined as Promise<void> | undefined,
  writeReady: () => {},
  raw: undefined as unknown,
  nativeRaw: undefined as unknown,
  getters: 0,
  snapshotPath: (value: string) => /[\\/]snapshots[\\/]/.test(value),
}));

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile(...args: Parameters<typeof actual.readFile>) {
      if (!controls.readArmed || !String(args[0]).endsWith('active-task.json')) return actual.readFile(...args);
      if (controls.mode === 'throw-undefined') throw undefined;
      const nativeRaw = actual.readFile(...args);
      const raw = controls.mode === 'reject-undefined'
        ? nativeRaw.then(() => { throw undefined; }, () => { throw undefined; })
        : nativeRaw;
      controls.nativeRaw = nativeRaw;
      controls.raw = raw;
      controls.readAttached = true;
      Object.defineProperty(raw, Symbol('original-read-child'), { value: controls.readTail });
      if (controls.mode === 'unknown') Object.defineProperty(raw, 'unread', {
        get() { controls.getters++; throw Error('fixture getter must not execute'); },
      });
      void raw.then(() => controls.readReady(), () => controls.readReady());
      return raw;
    },
    async open(...args: Parameters<typeof actual.open>) {
      const handle = await actual.open(...args);
      if (controls.writeArmed && !controls.writeAttached && controls.snapshotPath(String(args[0]))) {
        controls.writeAttached = true;
        const sync = handle.sync;
        Object.defineProperty(handle, 'sync', { value() {
          const raw = Reflect.apply(sync, handle, []);
          Object.defineProperty(raw, Symbol('original-write-child'), { value: controls.writeTail });
          void raw.then(() => controls.writeReady(), () => controls.writeReady());
          return raw;
        } });
      }
      return handle;
    },
  };
});

import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';

const pending: Promise<unknown>[] = [];
const releases: Array<() => void> = [];
const stores: Array<{ root: string; store: FileTaskSnapshotStore }> = [];
const expectedUnknownStores = new Set<FileTaskSnapshotStore>();
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(yes => { release = yes; });
  releases.push(release);
  return { promise, release };
}
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'store-close-physical-')));
  const store = new FileTaskSnapshotStore(root);
  stores.push({ root, store });
  return { root, store };
}
function readGate(mode: typeof controls.mode = 'normal') {
  const tail = deferred(), ready = deferred();
  controls.mode = mode;
  controls.readArmed = true;
  controls.readTail = tail.promise;
  controls.readReady = ready.release;
  return { tail, ready: ready.promise };
}
function trackClose(store: FileTaskSnapshotStore) {
  const result: { state?: 'fulfilled' | 'rejected'; error?: unknown } = {};
  const promise = store.closeAndDrain().then(() => { result.state = 'fulfilled'; }, error => {
    result.state = 'rejected';
    result.error = error;
  });
  pending.push(promise);
  return { result, promise };
}
const tick = () => new Promise<void>(yes => setImmediate(yes));
function read(store: FileTaskSnapshotStore) {
  const promise = store.getActiveTasks();
  pending.push(promise);
  return promise;
}

afterEach(async () => {
  const failures: unknown[] = [];
  controls.readArmed = false;
  controls.writeArmed = false;
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(pending.splice(0));
  for (const { root, store } of stores.splice(0)) {
    const expectedUnknown = expectedUnknownStores.delete(store);
    try {
      await store.closeAndDrain();
      if (expectedUnknown) {
        failures.push(Error('fixture_unknown_unexpectedly_closed'));
        console.info(JSON.stringify({ retainedUnknownRoot: root, physicalClosedNotClaimed: true }));
      } else rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } catch (error) {
      // Preserve the actual unknown root; the test does not grant retirement.
      console.info(JSON.stringify({ retainedUnknownRoot: root, physicalClosedNotClaimed: true }));
      if (!expectedUnknown) failures.push(error);
    }
  }
  Object.assign(controls, { mode: 'normal', readAttached: false, writeAttached: false,
    readTail: undefined, writeTail: undefined, raw: undefined, nativeRaw: undefined, getters: 0 });
  if (failures.length) throw new AggregateError(failures, 'store_close_physical_test_cleanup');
});

it('joins an accepted actual read and its own-symbol tail before close acknowledges', async () => {
  const { root, store } = fixture(), gate = readGate();
  writeFileSync(join(root, 'active-task.json'), JSON.stringify({ activeTaskIds: ['original'] }));
  const reading = read(store);
  await gate.ready;
  expect(types.isPromise(controls.nativeRaw)).toBe(true);
  expect(controls.raw).toBe(controls.nativeRaw);
  const closing = trackClose(store);
  await tick();
  expect(closing.result.state).toBeUndefined();
  gate.tail.release();
  expect(await reading).toEqual([{ taskId: 'original' }]);
  await closing.promise;
  expect(closing.result.state).toBe('fulfilled');
  controls.readArmed = false;
  expect(await store.getActiveTasks()).toEqual([{ taskId: 'original' }]);
  await expect(store.save({ taskId: 'new', sessionId: 'session', status: 'running', prompt: 'closed',
    materials: [], events: [], createdAt: 1, updatedAt: 2 })).rejects.toThrow('task_store_closed');
});

it('includes a read admitted while the original writer queue is draining', async () => {
  // Exercise the exact matcher used by the real open wrapper on both host paths.
  expect(controls.snapshotPath('C:\\qa\\snapshots\\queued.json')).toBe(true);
  expect(controls.snapshotPath('/qa/snapshots/queued.json')).toBe(true);
  expect(controls.snapshotPath('C:\\qa\\not-snapshots\\queued.json')).toBe(false);
  const { store } = fixture(), writeTail = deferred(), writeReady = deferred();
  const snapshot = { taskId: 'queued', sessionId: 'session', status: 'running' as const, prompt: 'accepted',
    materials: [], events: [], createdAt: 1, updatedAt: 2 };
  await store.save(snapshot);
  controls.writeArmed = true;
  controls.writeTail = writeTail.promise;
  controls.writeReady = writeReady.release;
  const writing = store.saveWithReceipt(snapshot);
  pending.push(writing);
  await writeReady.promise;
  const closing = trackClose(store), gate = readGate();
  const reading = read(store);
  await gate.ready;
  writeTail.release();
  await writing;
  await tick();
  expect(closing.result.state).toBeUndefined();
  gate.tail.release();
  await reading;
  await closing.promise;
  expect(closing.result.state).toBe('fulfilled');
});

it.each(['normal', 'reject-undefined'] as const)('drains an actual %s read rejection and its known child before acknowledging', async mode => {
  const { store } = fixture(), gate = readGate(mode);
  // The real filesystem rejects ENOENT. The second variant injects the original
  // undefined rejection at the returned Promise boundary, without bypassing IO.
  const reading = read(store);
  await gate.ready;
  const closing = trackClose(store);
  await tick();
  expect(controls.readAttached).toBe(true);
  expect(types.isPromise(controls.raw)).toBe(true);
  expect(closing.result.state).toBeUndefined();
  gate.tail.release();
  // This pre-existing metadata API projects a failed index read to an empty list.
  expect(await reading).toEqual([]);
  await closing.promise;
  expect(closing.result.state).toBe('fulfilled');
});

it('preserves bare undefined failure presence without declaring its invocation known', async () => {
  const { store } = fixture();
  expectedUnknownStores.add(store);
  readGate('throw-undefined');
  expect(await read(store)).toEqual([]);
  const closing = trackClose(store);
  await closing.promise;
  expect(closing.result.state).toBe('rejected');
  expect(closing.result.error).toMatchObject({ message: 'TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED' });
  expect(Object.hasOwn(closing.result.error as object, 'cause')).toBe(true);
  expect((closing.result.error as Error).cause).toBeUndefined();
  await expect(store.closeAndDrain()).rejects.toThrow('TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED');
});

it('joins the known original tail before rejecting a coexisting unknown accessor without reading it', async () => {
  const { root, store } = fixture(), gate = readGate('unknown');
  expectedUnknownStores.add(store);
  writeFileSync(join(root, 'active-task.json'), JSON.stringify({ activeTaskIds: [] }));
  const reading = read(store);
  await gate.ready;
  const closing = trackClose(store);
  await tick();
  expect(controls.getters).toBe(0);
  expect(closing.result.state).toBeUndefined();
  gate.tail.release();
  await reading;
  await closing.promise;
  expect(closing.result.state).toBe('rejected');
  expect(closing.result.error).toMatchObject({ message: 'TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED' });
  expect(controls.getters).toBe(0);
  await expect(store.closeAndDrain()).rejects.toThrow('TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED');
});
