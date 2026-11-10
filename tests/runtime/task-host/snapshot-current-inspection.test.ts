import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const interception = vi.hoisted(() => ({ path: undefined as string | undefined, tail: undefined as Promise<unknown> | undefined, entered: undefined as (() => void) | undefined, finished: undefined as (() => void) | undefined, statPath: undefined as string | undefined, statTail: undefined as Promise<void> | undefined, statEntered: undefined as (() => void) | undefined }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: (...args: Parameters<typeof actual.readFile>) => {
    const raw = actual.readFile(...args);
    if (interception.path === String(args[0]) && interception.tail) {
      Object.defineProperty(raw, Symbol('held-inspection-read-child'), { value: interception.tail });
      interception.entered?.();
      void raw.then(() => interception.finished?.(), () => interception.finished?.());
    }
    return raw;
  } };
});
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, lstatSync: (...args: Parameters<typeof actual.lstatSync>) => {
    const value = actual.lstatSync(...args);
    if (interception.statPath === String(args[0]) && interception.statTail) {
      Object.defineProperty(value, Symbol('held-inspection-stat-child'), { value: interception.statTail });
      interception.statEntered?.();
    }
    return value;
  } };
});
import { FileTaskSnapshotStore, readOriginalTaskStorePhysicalIO } from '../../../src/runtime/task-host/snapshot-store.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
let root: string;
const stores: FileTaskSnapshotStore[] = [];
const snapshot = (taskId: string, status: TaskSnapshot['status'] = 'completed'): TaskSnapshot => ({ taskId, sessionId: 'session', status, prompt: 'original', materials: [], events: [], createdAt: 1, updatedAt: 2 });
const store = () => { const value = new FileTaskSnapshotStore(root); stores.push(value); return value; };
const checkpoint = (id = 'task') => join(root, 'snapshots', id + '.json');
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'xiaok-current-inspection-')); });
afterEach(async () => { interception.path = undefined; interception.tail = undefined; interception.entered = undefined; interception.finished = undefined; interception.statPath = undefined; interception.statTail = undefined; interception.statEntered = undefined; for (const value of stores.splice(0)) await value.closeAndDrain(); rmSync(root, { recursive: true, force: true }); });

it('reads durable changes independently of a populated execution cache', async () => {
  const owner = store(); await owner.save(snapshot('task')); await owner.recoverTask('task');
  const current = JSON.parse(readFileSync(checkpoint(), 'utf8')); current.prompt = 'durable update'; writeFileSync(checkpoint(), JSON.stringify(current));
  expect((await owner.inspectPersistedTask('task'))?.prompt).toBe('durable update');
  expect((await owner.recoverTask('task'))?.prompt).toBe('original');
});

it('does not seed the execution cache and does not revive a deleted checkpoint', async () => {
  await store().save(snapshot('task')); const reader = store();
  expect((await reader.inspectPersistedTask('task'))?.prompt).toBe('original');
  const current = JSON.parse(readFileSync(checkpoint(), 'utf8')); current.prompt = 'later durable update'; writeFileSync(checkpoint(), JSON.stringify(current));
  expect((await reader.recoverTask('task'))?.prompt).toBe('later durable update');
  unlinkSync(checkpoint()); expect(await reader.inspectPersistedTask('task')).toBeNull();
});

it('preserves current task identities containing dots and refuses path traversal', async () => {
  const owner = store(); await owner.save(snapshot('task.one'));
  expect((await owner.inspectPersistedTask('task.one'))?.taskId).toBe('task.one');
  expect((await owner.inspectPersistedInventory()).map(value => value.taskId)).toEqual(['task.one']);
  await expect(owner.inspectPersistedTask('../task.one')).rejects.toThrow('task_identity_conflict');
});

it('uses actual checkpoint and journal replay without treating data as completion proof', async () => {
  const owner = store(), first = snapshot('task', 'running'); await owner.save(first);
  const next = { ...first, updatedAt: 3, events: [{ type: 'assistant_delta' as const, delta: 'actual journal text' }] };
  await owner.save(next, first);
  const read = await store().inspectPersistedTask('task');
  expect(read?.events).toEqual(next.events); expect(read?.status).toBe('running');
});

it('includes terminal history outside the active index', async () => {
  const owner = store(); await owner.save(snapshot('one')); await owner.save(snapshot('two', 'failed')); await owner.save(snapshot('three', 'running'));
  expect(await owner.getActiveTasks()).toEqual([{ taskId: 'three' }]);
  expect((await store().inspectPersistedInventory()).map(value => value.taskId).sort()).toEqual(['one', 'three', 'two']);
});

it('returns empty only for a genuinely absent snapshot directory and rejects orphan journals', async () => {
  const reader = store(); expect(await reader.inspectPersistedInventory()).toEqual([]);
  mkdirSync(join(root, 'snapshots')); writeFileSync(join(root, 'snapshots', 'orphan.journal.jsonl'), '{}\n');
  await expect(reader.inspectPersistedInventory()).rejects.toThrow('task_inventory_unavailable');
});

it('rejects corruption and identity mismatch rather than returning partial inventory', async () => {
  const owner = store(); await owner.save(snapshot('task')); writeFileSync(checkpoint(), '{broken');
  await expect(owner.inspectPersistedInventory()).rejects.toThrow();
  writeFileSync(checkpoint(), JSON.stringify(snapshot('different')));
  await expect(owner.inspectPersistedTask('task')).rejects.toThrow();
});

it('recognizes only the original checkpoint temporary convention and rejects unknown members', async () => {
  const owner = store(); await owner.save(snapshot('task'));
  writeFileSync(join(root, 'snapshots', 'task.json.123.456.abc.tmp'), 'uncommitted');
  expect((await owner.inspectPersistedInventory()).map(value => value.taskId)).toEqual(['task']);
  writeFileSync(join(root, 'snapshots', 'unexpected.bin'), 'unknown');
  await expect(owner.inspectPersistedInventory()).rejects.toThrow('task_inventory_unavailable');
});

it('rejects an actual hardlink in the inventory without modifying its original bytes', async () => {
  const owner = store(); await owner.save(snapshot('task')); const before = readFileSync(checkpoint());
  linkSync(checkpoint(), join(root, 'snapshots', 'alias.json'));
  await expect(owner.inspectPersistedInventory()).rejects.toThrow('task_inventory_unavailable');
  await expect(owner.inspectPersistedTask('task')).rejects.toThrow('task_inventory_unavailable');
  expect(readFileSync(checkpoint())).toEqual(before);
});

it('rejects an actual symlink or Windows junction at the snapshot directory', async () => {
  const owner = store(); await owner.save(snapshot('task')); const retained = join(root, 'retained'); renameSync(join(root, 'snapshots'), retained);
  symlinkSync(retained, join(root, 'snapshots'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(owner.inspectPersistedInventory()).rejects.toThrow('task_inventory_unavailable');
  expect(readFileSync(join(retained, 'task.json'), 'utf8')).toContain('original');
});

it('preserves the current protected-history marker', async () => {
  const owner = store(); await owner.save({ ...snapshot('task'), executionProtected: true });
  expect((await owner.inspectPersistedTask('task'))?.executionProtected).toBe(true);
});

it('joins a held own-symbol child on the actual readFile promise and preserves physical custody', async () => {
  const owner = store(); await owner.save(snapshot('task'));
  let release!: () => void, entered!: () => void, finished!: () => void;
  const tail = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; }), readDone = new Promise<void>(resolve => { finished = resolve; });
  interception.path = checkpoint(); interception.tail = tail; interception.entered = entered; interception.finished = finished;
  let settled = false;
  const observed = owner.inspectPersistedTask('task').then(value => { settled = true; return { ok: true as const, value }; }, error => { settled = true; return { ok: false as const, error }; });
  try {
    const early = observed.then(() => { throw new Error('inspection_settled_before_held_read'); });
    await Promise.race([started, early]); await Promise.race([readDone, early]);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false); expect(() => readOriginalTaskStorePhysicalIO(owner).capture().assertKnown()).toThrow();
  } finally { release(); await observed; }
  const result = await observed; if (!result.ok) throw result.error;
  expect(result.value?.prompt).toBe('original');
  const finalCut = readOriginalTaskStorePhysicalIO(owner).capture(); await finalCut.waitKnown(); finalCut.assertKnown();
});

it('joins a failed metadata SDK child before rejecting and retains the unknown physical fate', async () => {
  const owner = store(); await owner.save(snapshot('task'));
  let release!: () => void, entered!: () => void;
  const tail = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  interception.statPath = checkpoint(); interception.statTail = tail; interception.statEntered = entered;
  let settled = false;
  const observed = owner.inspectPersistedTask('task').then(value => { settled = true; return { ok: true as const, value }; }, error => { settled = true; return { ok: false as const, error }; });
  try {
    await Promise.race([started, observed.then(() => { throw new Error('metadata_sdk_not_entered'); })]);
    await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false);
  } finally { release(); await observed; }
  const result = await observed; expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unexpected_metadata_success');
  expect(result.error).toBeInstanceOf(Error);
  await expect(owner.closeAndDrain()).rejects.toThrow(/TASK_/);
  stores.splice(stores.indexOf(owner), 1);
});
