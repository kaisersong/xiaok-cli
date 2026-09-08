import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../renderer/src/api/bridge';

const state = vi.hoisted(() => ({ desktop: null as Record<string, unknown> | null }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => state.desktop, isDesktop: () => true }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); state.desktop = null; });

/** Storage transport double only; actual IndexedDB deletion is exercised in Electron E2E. */
function storage(autoCommit = true, initial?: { currentTaskId?: string; taskIds?: string[]; deletionPending?: boolean }) {
  let record = initial;
  let transaction: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; error?: Error; abort(): void; objectStore: () => unknown };
  const deletion = vi.fn(() => ({}));
  const put = vi.fn((value: typeof initial) => { record = value; return {}; });
  const open = vi.fn(() => {
    const request = { onsuccess: undefined as (() => void) | undefined, result: { close() {}, transaction: (_name: string, mode: string) => {
      let aborted = false, wroteRecord = false;
      const tx = { oncomplete: undefined as (() => void) | undefined, onabort: undefined as (() => void) | undefined,
        abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore: () => ({ delete: deletion, put: (value: typeof initial) => { wroteRecord = true; return put(value); },
          get: () => {
            const read = { result: record, onsuccess: undefined as (() => void) | undefined };
            queueMicrotask(() => { read.onsuccess?.(); if ((mode === 'readonly' || autoCommit || wroteRecord) && !aborted) queueMicrotask(() => tx.oncomplete?.()); });
            return read;
          },
        }) };
      transaction = tx;
      if (autoCommit) queueMicrotask(() => { if (!aborted) queueMicrotask(() => { if (!aborted) tx.oncomplete?.(); }); });
      return tx;
    } } };
    queueMicrotask(() => request.onsuccess?.()); return request;
  });
  vi.stubGlobal('indexedDB', { open });
  return { open, deletion, put, change: (value: typeof initial) => { record = value; }, commit: () => transaction.oncomplete?.() };
}
function desktop(resultState: string, alreadyDeleted = false) {
  const getMultiAgentThreadDeletion = vi.fn(async () => ({ threadId: 'thread', threadRevision: 7, deleteState: alreadyDeleted ? 'deleted' : 'none',
    operation: alreadyDeleted ? { operationId: 'old', state: 'completed' } : null }));
  const deleteMultiAgentThread = vi.fn(async (input: { operationId: string }) => ({ operationId: input.operationId, state: resultState }));
  const recoverTask = vi.fn(async () => ({ snapshot: { context: { threadId: 'thread' } } }));
  state.desktop = { getMultiAgentThreadDeletion, deleteMultiAgentThread, recoverTask }; return { getMultiAgentThreadDeletion, deleteMultiAgentThread, recoverTask };
}

describe('BDD: bridge deletes local metadata only after main completion', () => {
  it.each(['cleanup_pending', 'unknown'])('Given main returns %s, Then the conversation is retained and no mutation is automatically retried', async status => {
    const db = storage(true, { taskIds: [] }), transport = desktop(status);
    await expect(api.deleteThread('thread')).rejects.toThrow(status === 'unknown' ? /unknown/ : /pending/);
    expect(db.deletion).not.toHaveBeenCalled(); expect(transport.deleteMultiAgentThread).toHaveBeenCalledTimes(1);
    expect(transport.deleteMultiAgentThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread', expectedThreadRevision: 7, operationId: expect.stringMatching(/^delete:7:/), confirmTerminate: true }));
  });
  it.each([null, {}])('Given Desktop preload is missing or stale (%s), Then it never falls back to deleting IndexedDB', async preload => {
    const db = storage(); state.desktop = preload;
    await expect(api.deleteThread('thread')).rejects.toThrow(/unavailable/); expect(db.open).not.toHaveBeenCalled();
  });
  it('Given main committed before a lost acknowledgement, Then querying the tombstone recovers without another main mutation', async () => {
    const db = storage(), transport = desktop('completed', true);
    await api.deleteThread('thread'); expect(transport.getMultiAgentThreadDeletion).toHaveBeenCalledWith({ threadId: 'thread' });
    expect(transport.deleteMultiAgentThread).not.toHaveBeenCalled(); expect(db.deletion).toHaveBeenCalledWith('thread');
  });

  it('Given a reserved conversation and a completed tombstone, Then unavailable old task history cannot block acknowledgement recovery', async () => {
    const db = storage(true, { taskIds: ['task_old'], currentTaskId: 'task_old', deletionPending: true });
    const transport = desktop('completed', true); transport.recoverTask.mockRejectedValue(new Error('history_unavailable'));
    await api.deleteThread('thread');
    expect(transport.getMultiAgentThreadDeletion).toHaveBeenCalledTimes(1); expect(transport.recoverTask).not.toHaveBeenCalled();
    expect(transport.deleteMultiAgentThread).not.toHaveBeenCalled(); expect(db.deletion).toHaveBeenCalledWith('thread');
  });

  it('Given a reservation, Then reselecting a different old task cannot change the deletion identity', async () => {
    const db = storage(true, { taskIds: ['task_old', 'task_current'], currentTaskId: 'task_current', deletionPending: true });
    await expect(api.updateThreadTaskId('thread', 'task_old')).rejects.toThrow(/thread_deletion_pending/);
    expect(db.put).not.toHaveBeenCalled();
  });
  it('Given a reservation, Then reattaching the current already-recorded task is an identity-preserving no-op', async () => {
    const db = storage(true, { taskIds: ['task_old', 'task_current'], currentTaskId: 'task_current', deletionPending: true });
    await api.updateThreadTaskId('thread', 'task_current');
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ taskIds: ['task_old', 'task_current'], currentTaskId: 'task_current', deletionPending: true }));
  });
  it('Given a completed main tombstone but no local reservation, Then an unverified foreign association is still retained', async () => {
    const db = storage(true, { taskIds: ['task_foreign'], currentTaskId: 'task_foreign' });
    const transport = desktop('completed', true); transport.recoverTask.mockResolvedValue({ snapshot: { context: { threadId: 'foreign' } } });
    await expect(api.deleteThread('thread')).rejects.toThrow(/unavailable/);
    expect(transport.recoverTask).toHaveBeenCalledWith('task_foreign'); expect(db.deletion).not.toHaveBeenCalled();
    expect(transport.deleteMultiAgentThread).not.toHaveBeenCalled();
  });
  it('Given main completes, Then bridge still waits for the local transaction commit before reporting success', async () => {
    const db = storage(false, { taskIds: [] }); desktop('completed'); let completed = false;
    const deleting = api.deleteThread('thread').then(() => { completed = true; });
    await vi.waitFor(() => expect(db.deletion).toHaveBeenCalledWith('thread')); expect(completed).toBe(false);
    db.commit(); await deleting; expect(completed).toBe(true);
  });
  it('Given another entry removes the local record after main completed, Then final local acknowledgement is idempotently successful', async () => {
    const db = storage(true, { taskIds: ['task_old'], currentTaskId: 'task_old' }); const transport = desktop('completed');
    transport.deleteMultiAgentThread.mockImplementation(async input => { db.change(undefined); return { operationId: input.operationId, state: 'completed' }; });
    await expect(api.deleteThread('thread')).resolves.toBeUndefined(); expect(db.deletion).toHaveBeenCalledWith('thread');
  });
  it('Given the local entry is missing but main has not completed deletion, Then no unreserved mutation is submitted', async () => {
    const db = storage(), transport = desktop('completed');
    await expect(api.deleteThread('thread')).rejects.toThrow(/pending/);
    expect(transport.deleteMultiAgentThread).not.toHaveBeenCalled(); expect(transport.recoverTask).not.toHaveBeenCalled(); expect(db.deletion).not.toHaveBeenCalled();
  });

  it.each(['foreign-thread', undefined])('Given a cached task belongs to %s instead of this main thread, Then it refuses deletion rather than treating an empty shadow binding as proof of cleanup', async threadId => {
    const db = storage(true, { taskIds: ['task_real'], currentTaskId: 'task_real' });
    const transport = desktop('completed'); transport.recoverTask.mockResolvedValue({ snapshot: { context: { threadId } } } as never);
    await expect(api.deleteThread('thread')).rejects.toThrow(/unavailable/);
    expect(transport.deleteMultiAgentThread).not.toHaveBeenCalled(); expect(db.deletion).not.toHaveBeenCalled();
  });

  it('Given a new task association commits before the deletion reservation, Then the local transaction retains the changed conversation and does not submit deletion', async () => {
    const db = storage(true, { taskIds: ['task_old'], currentTaskId: 'task_old' }); const transport = desktop('completed');
    transport.recoverTask.mockImplementation(async () => {
      db.change({ taskIds: ['task_old', 'task_new'], currentTaskId: 'task_new' }); return { snapshot: { context: { threadId: 'thread' } } };
    });
    await expect(api.deleteThread('thread')).rejects.toThrow(/pending/);
    expect(transport.recoverTask).toHaveBeenCalledWith('task_old'); expect(db.deletion).not.toHaveBeenCalled(); expect(transport.deleteMultiAgentThread).not.toHaveBeenCalled();
  });

  it('Given the reservation commits first, Then a later attachment is rejected before it can point a new run at the deleted main thread', async () => {
    const db = storage(true, { taskIds: ['task_old'], currentTaskId: 'task_old' }); const transport = desktop('completed');
    transport.deleteMultiAgentThread.mockImplementation(async input => {
      expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ deletionPending: true }));
      await expect(api.updateThreadTaskId('thread', 'task_new')).rejects.toThrow(/thread_deletion_pending/);
      return { operationId: input.operationId, state: 'completed' };
    });
    await api.deleteThread('thread'); expect(db.deletion).toHaveBeenCalledWith('thread');
  });

  it.each(['title', 'sidebar'])('Given a reserved thread, Then the %s sibling update preserves its reservation', async kind => {
    const db = storage(true, { taskIds: [], deletionPending: true });
    if (kind === 'title') await api.updateThreadTitle('thread', 'new title'); else await api.updateThreadSidebarState('thread', { starred: true });
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ deletionPending: true }));
  });

  it('Given deletion commits before a later task attachment, Then attachment does not recreate the missing conversation', async () => {
    const db = storage();
    await expect(api.updateThreadTaskId('thread', 'task_new')).rejects.toThrow(/thread_not_found/);
    expect(db.put).not.toHaveBeenCalled();
  });
});
