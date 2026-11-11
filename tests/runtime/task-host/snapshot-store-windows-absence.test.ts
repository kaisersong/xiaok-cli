import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

// Real FileTaskSnapshotStore + real Windows absence reader on a win32 route.
// Only the packaged helper files (with a stable file identity) and the helper
// process are scripted; every other file operation is the real one.
const fixture = vi.hoisted(() => ({ spawned: 0, helperReads: 0, manifestReads: 0, reply: '{"version":1,"kind":"ordinary"}' }));
vi.mock('node:fs', async load => {
  const actual = await load<typeof import('node:fs')>();
  const helperBytes = Buffer.from('MZ-fixture-native-only');
  const isHelper = (path: unknown) => String(path).includes('windows-installation-absence.');
  return { ...actual,
    lstatSync(path: any, ...args: any[]) {
      if (!isHelper(path)) return Reflect.apply(actual.lstatSync, actual, [path, ...args]);
      const json = String(path).endsWith('.json'), seed = json ? 20n : 10n;
      return args[0]?.bigint
        ? { isFile: () => true, isSymbolicLink: () => false, nlink: 1n, dev: 1n, ino: seed, size: json ? 200n : 22n, mtimeNs: seed, ctimeNs: seed }
        : { isFile: () => true, isSymbolicLink: () => false, nlink: 1, size: json ? 200 : 22 };
    },
    readFileSync(path: any, ...args: any[]) {
      if (!isHelper(path)) return Reflect.apply(actual.readFileSync, actual, [path, ...args]);
      if (String(path).endsWith('.json')) { fixture.manifestReads++; return Buffer.from(JSON.stringify({ version: 1, target: 'win32-' + process.arch, sourceSha256: '1'.repeat(64), coreSha256: '2'.repeat(64), sha256: createHash('sha256').update(helperBytes).digest('hex') })); }
      fixture.helperReads++; return helperBytes;
    },
  };
});
vi.mock('node:child_process', async load => {
  const actual = await load<typeof import('node:child_process')>();
  return { ...actual, spawnSync(path: string, ...rest: any[]) {
    if (!path.endsWith('windows-installation-absence.exe')) return Reflect.apply(actual.spawnSync, actual, [path, ...rest]);
    fixture.spawned++; return { status: 0, stdout: Buffer.from(fixture.reply), stderr: Buffer.alloc(0) };
  } };
});
vi.mock('node:os', async load => {
  const actual = await load<typeof import('node:os')>();
  return { ...actual, machine: () => (process.arch === 'arm64' ? 'ARM64' : 'AMD64') };
});
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const baseSnapshot = (taskId: string): TaskSnapshot => ({ taskId, sessionId: 'sess_1', status: 'running', prompt: 'p', materials: [], events: [], createdAt: 1, updatedAt: 2 });
const withEvent = (snapshot: TaskSnapshot, id: string): TaskSnapshot => ({ ...snapshot, events: [...snapshot.events, { type: 'assistant_delta', eventId: id, delta: 'x' }], updatedAt: snapshot.updatedAt + 1 });
function newStore(): FileTaskSnapshotStore {
  const root = mkdtempSync(join(tmpdir(), 'task-store-win-absence-')); roots.push(root);
  return new FileTaskSnapshotStore(root);
}

it('spawns the absence helper exactly once per save (one write job), hashing the unchanged helper once', async () => {
  fixture.reply = '{"version":1,"kind":"ordinary"}';
  const store = newStore();
  let snapshot = baseSnapshot('task_win');
  const perSave: number[] = [];
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  for (let index = 0; index < 5; index += 1) {
    snapshot = withEvent(snapshot, `event-${index}`);
    const before = fixture.spawned;
    await store.save(snapshot);
    perSave.push(fixture.spawned - before);
  }
  // #enqueueWrite: the route check at job start spawns; observeOrdinaryDirectoryWriter's
  // check and the route check after it reuse that job's own answer. Nothing crosses a save.
  expect(perSave).toEqual([1, 1, 1, 1, 1]);
  expect(fixture.spawned).toBe(5);
  // Integrity is verified once (manifest parse + one helper hash) and then
  // reused only because the fixture keeps both files' identity unchanged.
  expect(fixture.helperReads).toBe(1);
  expect(fixture.manifestReads).toBe(2);
  // A changed system answer is still seen by the very next save.
  fixture.reply = '{"version":1,"kind":"installed"}';
  const before = fixture.spawned;
  await expect(store.save(withEvent(snapshot, 'event-installed'))).rejects.toThrow('ordinary_source_route');
  expect(fixture.spawned - before).toBe(1);
});

it('does not carry a failed job\'s ordinary answer into the next job', async () => {
  fixture.reply = '{"version":1,"kind":"ordinary"}';
  const store = newStore();
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  const first = withEvent(withEvent(baseSnapshot('task_err'), 'event-a'), 'event-b');
  await store.save(first);
  // Dropping an event fails inside the job's action, after the route checks.
  let before = fixture.spawned;
  await expect(store.save({ ...first, events: first.events.slice(0, 1), updatedAt: 50 })).rejects.toThrow();
  expect(fixture.spawned - before).toBe(1);
  fixture.reply = '{"version":1,"kind":"installed"}';
  before = fixture.spawned;
  await expect(store.save(withEvent(first, 'event-c'))).rejects.toThrow('ordinary_source_route');
  expect(fixture.spawned - before).toBe(1);
  fixture.reply = '{"version":1,"kind":"ordinary"}';
  before = fixture.spawned;
  await store.save(withEvent(first, 'event-d'));
  expect(fixture.spawned - before).toBe(1);
});

it('gives overlapping jobs on different stores their own spawn each', async () => {
  fixture.reply = '{"version":1,"kind":"ordinary"}';
  const left = newStore(), right = newStore();
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  const before = fixture.spawned;
  let settled = 0, spawnedBeforeFirstSettle = -1;
  const track = (job: Promise<void>) => job.then(() => { if (settled++ === 0) spawnedBeforeFirstSettle = fixture.spawned - before; });
  await Promise.all([track(left.save(withEvent(baseSnapshot('task_left'), 'l'))), track(right.save(withEvent(baseSnapshot('task_right'), 'r')))]);
  // Both jobs were in flight together, and neither reused the other's answer.
  expect(spawnedBeforeFirstSettle).toBe(2);
  expect(fixture.spawned - before).toBe(2);
});
