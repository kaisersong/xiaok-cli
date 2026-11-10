// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FileTaskSnapshotStore, recoverTaskSnapshotSync } from '../../../src/runtime/task-host/snapshot-store.js';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { contextDerivative } from '../fixtures/context-derivative.js';

// New main-only API contracts. Missing API failures are not vulnerability REDs.
it('reads real raw Task history, freezes detached results, and rechecks old batches after source revocation', async () => {
  const f = await contextDerivative();
  try {
    const batch = await f.services.taskHistory.readRecent();
    expect(batch.snapshots.find(snapshot => snapshot.taskId === f.taskId)?.result?.summary).toContain('DERIVED_PRIVATE_SOURCE_CANARY');
    expect(Object.isFrozen(batch)).toBe(true); expect(Object.isFrozen(batch.snapshots)).toBe(true);
    expect(batch.snapshots.every(snapshot => Object.isFrozen(snapshot) && Object.isFrozen(snapshot.events))).toBe(true);
    expect(Object.isFrozen((await f.read()).snapshot)).toBe(false);
    f.services.taskHistory.assertCurrent(batch); f.revoke();
    expect(() => f.services.taskHistory.assertCurrent(batch)).toThrow('task_history_unavailable');
    await expect(f.services.taskHistory.readRecent()).rejects.toThrow('task_history_unavailable');
    expect(readFileSync(join(f.root, 'tasks', 'snapshots', `${f.taskId}.json`), 'utf8')).toContain('DERIVED_PRIVATE_SOURCE_CANARY');
  } finally { await f.close(); }
});

it('refuses cloned, null and another real services owner batch', async () => {
  const f = await contextDerivative(), other = await contextDerivative();
  try {
    const batch = await f.services.taskHistory.readRecent();
    for (const forged of [null, JSON.parse(JSON.stringify(batch)), { snapshots: [] }]) {
      expect(() => f.services.taskHistory.assertCurrent(forged)).toThrow('task_history_unavailable');
    }
    expect(() => other.services.taskHistory.assertCurrent(batch)).toThrow('task_history_unavailable');
  } finally { await other.close(); await f.close(); }
});

it('rejects a batch when later actual authorization IO revokes its earlier contributing Task', async () => {
  const f = await contextDerivative(), original = FileTaskSnapshotStore.prototype.recoverTask;
  let injected = false; const seen: string[] = [];
  const spy = vi.spyOn(FileTaskSnapshotStore.prototype, 'recoverTask').mockImplementation(async function (...args) {
    const result = await original.apply(this, args);
    seen.push(args[0]);
    if (args[0] === f.sourceTaskId && !injected) { injected = true; queueMicrotask(() => f.revoke()); }
    return result;
  });
  try {
    await expect(f.services.taskHistory.readRecent()).rejects.toThrow('task_history_unavailable'); expect(injected).toBe(true);
    expect(seen.indexOf(f.taskId)).toBeGreaterThanOrEqual(0); expect(seen.indexOf(f.taskId)).toBeLessThan(seen.indexOf(f.sourceTaskId));
    await expect(f.read()).rejects.toThrow('not_readable');
  } finally { spy.mockRestore(); await f.close(); }
});

it('does not authorize a fresh foreign raw thread using the main stores prewarmed old thread cache', async () => {
  const f = await contextDerivative();
  try {
    await f.services.authorizeTaskRead(f.taskId, f.services.continuity.port().actor);
    const root = join(f.root, 'tasks'), store = new FileTaskSnapshotStore(root), before = recoverTaskSnapshotSync(root, f.taskId)!;
    await store.save({ ...before, context: { ...before.context, threadId: 'changed-raw-thread' } });
    await expect(f.services.taskHistory.readRecent()).rejects.toThrow('task_history_unavailable');
  } finally { await f.close(); }
});

it.each(['epoch', 'body'] as const)('invalidates a batch after a %s-only journal change with its checkpoint unchanged', async kind => {
  const f = await contextDerivative();
  try {
    const batch = await f.services.taskHistory.readRecent(), root = join(f.root, 'tasks'), store = new FileTaskSnapshotStore(root);
    const checkpoint = join(root, 'snapshots', `${f.taskId}.json`), beforeBytes = readFileSync(checkpoint, 'utf8');
    const before = recoverTaskSnapshotSync(root, f.taskId)!;
    await store.save({ ...before, status: 'running', ...(kind === 'epoch' ? { sessionId: 'changed-journal-epoch' }
      : { result: { ...before.result!, summary: 'changed-journal-body' } }) });
    expect(readFileSync(checkpoint, 'utf8')).toBe(beforeBytes);
    expect(readFileSync(join(root, 'snapshots', `${f.taskId}.journal.jsonl`), 'utf8')).not.toBe('');
    expect(() => f.services.taskHistory.assertCurrent(batch)).toThrow('task_history_unavailable');
  } finally { await f.close(); }
});

it('does not sign orphan journals as an empty or partial valid history', async () => {
  const f = await contextDerivative();
  try {
    writeFileSync(join(f.root, 'tasks', 'snapshots', 'task_orphan.journal.jsonl'), '{}\n');
    await expect(f.services.taskHistory.readRecent()).rejects.toThrow('task_history_unavailable');
  } finally { await f.close(); }
});

it('checks real main owner lifecycle even for an explicitly issued empty batch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'task-history-empty-'));
  const services = createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'), dataRoot: root, runner: async () => undefined,
    kswarmService: { getStatus: () => ({ running: false, port: 0 }), request: async () => new Response('{}'), getDesktopMutationToken: () => 'test' } as never });
  try {
    const batch = await services.taskHistory.readRecent(); expect(batch.snapshots).toEqual([]); services.taskHistory.assertCurrent(batch);
    await services.disposeMultiAgent();
    expect(() => services.taskHistory.assertCurrent(batch)).toThrow('task_history_unavailable');
    await expect(services.taskHistory.readRecent()).rejects.toThrow('task_history_unavailable');
  } finally { await services.disposeMultiAgent(); rmSync(root, { recursive: true, force: true }); }
});
