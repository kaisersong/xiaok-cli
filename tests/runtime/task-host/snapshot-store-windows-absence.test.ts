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

it('spawns the absence helper for every route check of every separate save, hashing the unchanged helper once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'task-store-win-absence-')); roots.push(root);
  const store = new FileTaskSnapshotStore(root);
  let snapshot: TaskSnapshot = { taskId: 'task_win', sessionId: 'sess_1', status: 'running', prompt: 'p', materials: [], events: [], createdAt: 1, updatedAt: 2 };
  const perSave: number[] = [];
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  for (let index = 0; index < 5; index += 1) {
    snapshot = { ...snapshot, events: [...snapshot.events, { type: 'assistant_delta', eventId: `event-${index}`, delta: 'x' }], updatedAt: index + 3 };
    const before = fixture.spawned;
    await store.save(snapshot);
    perSave.push(fixture.spawned - before);
  }
  // #enqueueWrite: route check at job start, observeOrdinaryDirectoryWriter's
  // own check, and the route check after it. No observation crosses a call.
  expect(perSave).toEqual([3, 3, 3, 3, 3]);
  expect(fixture.spawned).toBe(15);
  // Integrity is verified once (manifest parse + one helper hash) and then
  // reused only because the fixture keeps both files' identity unchanged.
  expect(fixture.helperReads).toBe(1);
  expect(fixture.manifestReads).toBe(2);
  // A changed system answer is still seen by the very next save.
  fixture.reply = '{"version":1,"kind":"installed"}';
  await expect(store.save({ ...snapshot, updatedAt: 99 })).rejects.toThrow('ordinary_source_route');
});
