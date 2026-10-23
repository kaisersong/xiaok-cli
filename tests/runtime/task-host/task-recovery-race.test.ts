import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

it('does not overwrite completion when a recovery read returns an older running snapshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'task-recovery-race-'));
  const store = new FileTaskSnapshotStore(join(root, 'tasks'));
  let finish!: () => void, releaseRead!: () => void, readEntered!: () => void;
  const runnerHeld = new Promise<void>(resolve => { finish = resolve; });
  const readHeld = new Promise<void>(resolve => { releaseRead = resolve; });
  const readStarted = new Promise<void>(resolve => { readEntered = resolve; });
  const host = new InProcessTaskRuntimeHost({ snapshotStore: store,
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
    createTaskId: () => 'fictional-task', runner: async () => { await runnerHeld; } });
  let recovery: ReturnType<typeof host.recoverTask> | undefined;
  const actualRead = store.recoverTask.bind(store);
  try {
    await host.createTask({ prompt: 'Return a short answer', materials: [] });
    await vi.waitFor(async () => expect((await actualRead('fictional-task'))?.status).toBe('running'));
    vi.spyOn(store, 'recoverTask').mockImplementationOnce(async (...args) => {
      const previous = await actualRead(...args);
      readEntered(); await readHeld; return previous;
    });
    recovery = host.recoverTask('fictional-task');
    await readStarted;
    finish();
    await vi.waitFor(() => expect(host.inFlightTaskIds()).toHaveLength(0));
    expect((await actualRead('fictional-task'))?.status).toBe('completed');
    releaseRead();
    const { snapshot } = await recovery;
    expect(snapshot.status).toBe('completed');
    expect(snapshot.events.filter(e => e.type === 'error' && e.message === 'stale_running_task_recovered')).toHaveLength(0);
    expect((await actualRead('fictional-task'))?.status).toBe('completed');
  } finally {
    finish(); releaseRead(); await recovery?.catch(() => {}); await host.drain(); vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

it.each(['none', 'error', 'terminal'] as const)('preserves stale recovery receipts and partial failure semantics: %s', async fault => {
  const root = mkdtempSync(join(tmpdir(), 'task-stale-receipts-'));
  const store = new FileTaskSnapshotStore(join(root, 'tasks'));
  const receipts: Array<{ type: string; status: string; index: number }> = [];
  const host = new InProcessTaskRuntimeHost({ snapshotStore: store,
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
    createTaskId: () => 'fictional-stale', runner: vi.fn(),
    onPersistedEvent: async input => {
      if (input.event.type === 'error' || input.event.type === 'task_terminal') receipts.push({ type: input.event.type, status: input.snapshot.status, index: input.eventIndex });
    } });
  try {
    await host.prepareTask({ prompt: 'Short fictional task', materials: [] });
    const original = (await store.recoverTask('fictional-stale'))!;
    await store.save({ ...original, status: 'running' });
    const save = store.save.bind(store);
    vi.spyOn(store, 'save').mockImplementation(async (next, previous) => {
      const error = next.events.at(-1)?.type === 'error';
      if (fault === 'error' && error || fault === 'terminal' && next.status === 'failed') throw Error('fixture_save_failed');
      await save(next, previous);
    });
    if (fault === 'none') expect((await host.recoverTask('fictional-stale')).snapshot.status).toBe('failed');
    else await expect(host.recoverTask('fictional-stale')).rejects.toThrow('fixture_save_failed');
    const expected = fault === 'none' ? [{ type: 'error', status: 'running' }, { type: 'task_terminal', status: 'failed' }]
      : fault === 'terminal' ? [{ type: 'error', status: 'running' }] : [];
    await vi.waitFor(() => expect(receipts.map(({ type, status }) => ({ type, status }))).toEqual(expected));
    const current = (await store.recoverTask('fictional-stale'))!;
    expect(current.status).toBe(fault === 'none' ? 'failed' : 'running');
    expect(current.events.filter(e => e.type === 'task_terminal')).toHaveLength(fault === 'none' ? 1 : 0);
    if (fault === 'none') {
      await host.recoverTask('fictional-stale');
      expect(receipts).toHaveLength(2);
      expect(receipts[1].index).toBe(receipts[0].index + 1);
    }
  } finally { await host.drain(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});

it('refuses same-task execution while an actual stale recovery write remains in flight', async () => {
  const root = mkdtempSync(join(tmpdir(), 'task-recovery-owner-'));
  const store = new FileTaskSnapshotStore(join(root, 'tasks')), runner = vi.fn();
  const host = new InProcessTaskRuntimeHost({ snapshotStore: store,
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
    createTaskId: () => 'fictional-owned', runner });
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { entered = resolve; });
  let recovery: ReturnType<typeof host.recoverTask> | undefined;
  try {
    await host.prepareTask({ prompt: 'Short fictional task', materials: [] });
    await store.save({ ...(await store.recoverTask('fictional-owned'))!, status: 'running' });
    const save = store.save.bind(store);
    vi.spyOn(store, 'save').mockImplementation(async (next: TaskSnapshot, previous) => {
      if (next.events.at(-1)?.type === 'error') { entered(); await held; }
      await save(next, previous);
    });
    recovery = host.recoverTask('fictional-owned');
    await writing;
    await expect(host.startTask('fictional-owned')).rejects.toThrow('task recovery in progress');
    expect(runner).not.toHaveBeenCalled();
    release(); expect((await recovery).snapshot.status).toBe('failed');
  } finally {
    release(); await recovery?.catch(() => {}); await host.drain(); vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

it.each(['error', 'terminal'])('preserves a concurrent durable completion on actual %s write conflict', async conflictAt => {
  const root = mkdtempSync(join(tmpdir(), 'task-recovery-conflict-'));
  const store = new FileTaskSnapshotStore(join(root, 'tasks'));
  const receipts: string[] = [];
  const host = new InProcessTaskRuntimeHost({ snapshotStore: store,
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
    createTaskId: () => 'fictional-conflict', runner: vi.fn(),
    onPersistedEvent: async input => { if (input.event.type === 'error' || input.event.type === 'task_terminal') receipts.push(input.event.type); } });
  try {
    await host.prepareTask({ prompt: 'Fictional task', materials: [] });
    await store.save({ ...(await store.recoverTask('fictional-conflict'))!, status: 'running' });
    const save = store.save.bind(store); let injected = false;
    vi.spyOn(store, 'save').mockImplementation(async (next, previous) => {
      if (!injected && next.events.at(-1)?.type === (conflictAt === 'error' ? 'error' : 'task_terminal')) {
        injected = true;
        const current = (await store.recoverTask('fictional-conflict'))!;
        await save({ ...current, status: 'completed', events: [...current.events, { type: 'task_terminal', status: 'completed' }] }, current);
      }
      await save(next, previous); // Real store append-only validation must reject the conflicting write.
    });
    await expect(host.recoverTask('fictional-conflict')).rejects.toThrow('task events are not append-only');
    const current = (await store.recoverTask('fictional-conflict'))!;
    expect(current.status).toBe('completed');
    expect(current.events.at(-1)).toEqual({ type: 'task_terminal', status: 'completed' });
    await vi.waitFor(() => expect(receipts).toEqual(conflictAt === 'error' ? [] : ['error']));
  } finally { await host.drain(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});
