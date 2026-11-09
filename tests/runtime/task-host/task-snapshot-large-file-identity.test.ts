import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';

const observed = vi.hoisted(() => ({enabled: false, bigint: 0, number: 0}));
vi.mock('node:fs', async load => {
  const actual = await load<typeof import('node:fs')>();
  function identity(stat: import('node:fs').Stats | import('node:fs').BigIntStats) {
    if (!observed.enabled) return stat;
    const exact = BigInt(stat.ino) + (1n << 60n);
    if (typeof stat.ino === 'bigint') observed.bigint++;
    else observed.number++;
    Object.defineProperty(stat, 'ino', {value: typeof stat.ino === 'bigint' ? exact : Number(exact), configurable: true});
    return stat;
  }
  return {...actual,
    lstatSync: (...args: Parameters<typeof actual.lstatSync>) => identity(Reflect.apply(actual.lstatSync, actual, args)),
    fstatSync: (...args: Parameters<typeof actual.fstatSync>) => identity(Reflect.apply(actual.fstatSync, actual, args)),
  };
});
const roots: string[] = [];
afterEach(() => {
  observed.enabled = false;
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true, maxRetries: 3});
});

it('keeps exact large file IDs through the actual task Source save, lock cleanup and drain', async () => {
  const root = mkdtempSync(join(tmpdir(), 'task-large-file-id-')); roots.push(root);
  const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
  const host = new InProcessTaskRuntimeHost({snapshotStore: snapshots,
    materialRegistry: new MaterialRegistry({workspaceRoot: join(root, 'materials'), maxBytes: 1024}),
    runner: async () => {}});
  observed.bigint = 0; observed.number = 0; observed.enabled = true;
  let failure: unknown;
  try {
    const task = await host.createTask({prompt: 'Short answer', materials: []});
    await host.drain();
    expect((await snapshots.recoverTask(task.taskId))?.status).toBe('completed');
    expect((await snapshots.readOriginalUserInput(task.taskId))?.prompt).toBe('Short answer');
    expect(observed.bigint).toBeGreaterThan(0);
    // Ordinary discovery also uses fs. Only Source custody requires BigInt;
    // its unchanged validator rejects every unsafe numeric identity above.
  } catch (error) {failure = error; throw error;}
  finally {
    try {await host.drain(); await snapshots.closeAndDrain();}
    catch (error) {if (failure === undefined) throw error;}
  }
});
