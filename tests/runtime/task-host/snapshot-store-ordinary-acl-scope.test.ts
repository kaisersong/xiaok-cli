import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

// Count real /bin/ls -lde spawns on darwin only. Linux acl() returns before
// spawnSync, so the N=N assertion uses the ordinary-route probe seam below.
const fixture = vi.hoisted(() => ({ spawns: [] as string[][] }));
vi.mock('node:child_process', async load => {
  const actual = await load<typeof import('node:child_process')>();
  return { ...actual, spawnSync(path: string, ...rest: any[]) {
    const args = rest[0];
    if (process.platform === 'darwin' && path === '/bin/ls' && Array.isArray(args) && args[0] === '-lde') {
      fixture.spawns.push(args.slice(1).map(String));
    }
    return Reflect.apply(actual.spawnSync, actual, [path, ...rest]);
  } };
});

import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { setOrdinaryRouteAclProbeListener } from '../../../src/runtime/verification/migration-markers.js';
import { setOrdinaryRouteJobScopeReuse } from '../../../src/runtime/verification/windows-installation-absence.js';

const posixAncestors = process.platform === 'darwin'
  ? ['/Library/Application Support', '/Library', '/']
  : ['/var/lib', '/var', '/'];

const roots: string[] = [];
const probes: string[][] = [];

beforeEach(() => {
  // Reverse control (not left enabled):
  //   XIAOK_ORDINARY_ROUTE_ACL_REUSE=0 npx vitest run tests/runtime/task-host/snapshot-store-ordinary-acl-scope.test.ts
  // That drops in-job reuse (equivalent to ignoring the write-job scope on the
  // darwin/linux ordinary path). The N=N assertion below goes red. Unset the
  // flag to restore the default.
  setOrdinaryRouteJobScopeReuse(process.env.XIAOK_ORDINARY_ROUTE_ACL_REUSE !== '0');
  probes.length = 0;
  fixture.spawns.length = 0;
  setOrdinaryRouteAclProbeListener(paths => { probes.push([...paths]); });
});
afterEach(() => {
  setOrdinaryRouteAclProbeListener();
  setOrdinaryRouteJobScopeReuse(true);
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const baseSnapshot = (taskId: string): TaskSnapshot => ({ taskId, sessionId: 'sess_1', status: 'running', prompt: 'p', materials: [], events: [], createdAt: 1, updatedAt: 2 });
const withEvent = (snapshot: TaskSnapshot, id: string): TaskSnapshot => ({ ...snapshot, events: [...snapshot.events, { type: 'assistant_delta', eventId: id, delta: 'x' }], updatedAt: snapshot.updatedAt + 1 });
function newStore(): FileTaskSnapshotStore {
  const root = mkdtempSync(join(tmpdir(), 'task-store-ordinary-acl-'));
  roots.push(root);
  return new FileTaskSnapshotStore(root);
}

it.skipIf(process.platform === 'win32')('probes ordinary-route ACL once per save in the same write task (N saves => N probes)', async () => {
  const store = newStore();
  let snapshot = baseSnapshot('task_acl');
  const perSave: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    snapshot = withEvent(snapshot, `event-${index}`);
    const before = probes.length;
    const spawnedBefore = fixture.spawns.length;
    await store.save(snapshot);
    const ran = probes.slice(before);
    perSave.push(ran.length);
    // First save registers the task-root (a real registry write); later saves
    // are unchanged observations. Each save is its own write job/scope, and
    // the one probe still covers the same 3 ancestor paths.
    expect(ran[0], `save ${index} ancestor paths`).toEqual(posixAncestors);
    if (process.platform === 'darwin') {
      expect(fixture.spawns.slice(spawnedBefore)).toEqual([posixAncestors]);
    }
  }
  // #enqueueWrite: the route checks and registerSource route checks in one job
  // share that job's own ordinary-route ACL probe. Nothing crosses a save.
  expect(perSave).toEqual([1, 1, 1, 1, 1]);
  expect(probes).toHaveLength(5);
  if (process.platform === 'darwin') expect(fixture.spawns).toHaveLength(5);
});
