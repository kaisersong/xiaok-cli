// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';

function barrier() { let resolve!: () => void; return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() }; }
type ScanOwner = { promise: Promise<unknown>; facts?: unknown };

describe('BDD A25: inner host read, whole scan and cancellation are distinct real owners', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { vi.useRealTimers(); for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });

  it('awaiting the first inspect is not scan completion; whole-scan and physical-cancel barriers make the later completed assertion deterministic', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-delete-scan-boundary-'));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
    const coordinator = new DesktopExecutionCoordinator(), goalStop = vi.fn(async () => {});
    const service = new DesktopMultiAgentService({ store, coordinator, closeGraceMs: 30,
      beforeThreadDeletion: goalStop, createSession: async () => ({ run: async () => '', dispose: async () => {} }) });
    service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
      assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
      runner: async () => { throw new Error('a prepared-only scan must never execute a model'); } });
    cleanup.push(async () => { await service.dispose(); await host.drain(); store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });
    await service.initialize(host);
    const access = service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
    const deletion = (nonce: string) => { const revision = store.getThread('thread')!.threadRevision!;
      return { access, requestSource: 'user' as const, operationId: `delete:${revision}:${nonce}`, expectedThreadRevision: revision, confirmTerminate: true as const }; };
    const task = await host.prepareTask({ prompt: 'prepared only', materials: [], context: { threadId: 'thread' } });
    const firstEntered = barrier(), firstRelease = barrier(), secondEntered = barrier(), secondRelease = barrier();
    const cancelEntered = barrier(), cancelRelease = barrier();
    cleanup.push(() => { firstRelease.resolve(); secondRelease.resolve(); cancelRelease.resolve(); });
    const originalInspect = host.inspectTask.bind(host), originalCancel = host.cancelTask.bind(host);
    let inspections = 0;
    const inspect = vi.spyOn(host, 'inspectTask').mockImplementation(async (...args) => {
      const index = ++inspections;
      if (index === 1) { firstEntered.resolve(); await firstRelease.promise; }
      if (index === 2) { secondEntered.resolve(); await secondRelease.promise; }
      return originalInspect(...args);
    });
    const active = vi.spyOn(host, 'getActiveTasks');
    const cancel = vi.spyOn(host, 'cancelTask').mockImplementation(async (...args) => {
      cancelEntered.resolve(); await cancelRelease.promise; return originalCancel(...args);
    });
    const scans = (service as unknown as { deletionScans: Map<string, ScanOwner> }).deletionScans;
    // Fake only the production absolute monotonic deadline and its timer.
    // Actual SQLite and FileTaskSnapshotStore promises are never substituted.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const firstAttempt = service.deleteThread(deletion('first-scan'));
    await firstEntered.promise;
    const owner = scans.get('thread')!; expect(owner).toBeDefined();
    await vi.advanceTimersByTimeAsync(31);
    expect(await firstAttempt).toMatchObject({ state: 'cleanup_pending' });
    expect(active).toHaveBeenCalledTimes(1); expect(inspect).toHaveBeenCalledTimes(1); expect(cancel).not.toHaveBeenCalled();
    expect(goalStop).toHaveBeenCalledTimes(1);

    // The original failing test awaited this first result and one microtask.
    // It belongs to getActiveTasks, not collect's later explicit inspect.
    firstRelease.resolve(); await inspect.mock.results[0]!.value; await secondEntered.promise;
    expect(scans.get('thread')).toBe(owner); expect(owner.facts).toBeUndefined();
    expect(active).toHaveBeenCalledTimes(1); expect(inspect).toHaveBeenCalledTimes(2);
    expect(await service.deleteThread(deletion('inner-read-only'))).toMatchObject({ state: 'cleanup_pending' });
    expect(cancel).not.toHaveBeenCalled(); expect(store.getThread('thread')?.deleteState).toBe('delete_pending');

    secondRelease.resolve(); await owner.promise;
    expect(owner.facts).toBeDefined(); expect(scans.get('thread')).toBe(owner);
    expect(cancel).not.toHaveBeenCalled(); expect(store.getThread('thread')?.deleteState).toBe('delete_pending');
    const consuming = service.deleteThread(deletion('consume-whole-scan'));
    await cancelEntered.promise;
    await vi.advanceTimersByTimeAsync(31);
    expect(await consuming).toMatchObject({ state: 'cleanup_pending' });
    expect(cancel).toHaveBeenCalledTimes(1); expect(active).toHaveBeenCalledTimes(1); expect(inspect).toHaveBeenCalledTimes(2);
    expect(store.getThread('thread')?.deleteState).toBe('delete_pending');
    const stopping = (service as unknown as { deletionStops: Map<string, { tasks: Map<string, { promise: Promise<void>; state: string }> }> }).deletionStops.get('thread')!.tasks.get(task.taskId)!;
    cancelRelease.resolve(); await stopping.promise;
    expect(stopping.state).toBe('confirmed');
    expect(store.getThread('thread')?.deleteState).toBe('delete_pending');
    expect(await service.deleteThread(deletion('physically-settled'))).toMatchObject({ state: 'completed' });
    expect(scans.has('thread')).toBe(false); expect(store.getThread('thread')?.deleteState).toBe('deleted');
    expect((await originalInspect(task.taskId))?.status).toBe('cancelled');
    expect(cancel).toHaveBeenCalledTimes(1); expect(active).toHaveBeenCalledTimes(1); expect(inspect).toHaveBeenCalledTimes(2);
    expect(goalStop).toHaveBeenCalledTimes(1);
    console.log('DELETE_SCAN_BOUNDARIES', { innerInspectCalls: inspections, wholeScans: active.mock.calls.length,
      cancelCalls: cancel.mock.calls.length, final: store.getThread('thread')?.deleteState, monotonicMs: performance.now() });
  });
});
