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


/** R288: these are preload/storage transport doubles, not grants or Main authorization evidence. */
function pendingDeletionDto(state: 'cleanup_pending' | 'unknown'): import('../../shared/multi-agent-types').MultiAgentThreadDeletionSnapshot {
  return { threadId: 'thread', threadRevision: 8, deleteState: 'delete_pending',
    operation: { operationId: 'delete:7:prior-user-attempt', state } };
}

describe('R288: an existing reservation resumes only a same-thread Main pending receipt', () => {
  it.each(['cleanup_pending', 'unknown'] as const)('resumes a %s receipt through a fresh Main operation without recovering old tasks', async status => {
    const db = storage(true, { currentTaskId: 'task_old', taskIds: ['task_old'], deletionPending: true });
    const transport = desktop('completed');
    transport.getMultiAgentThreadDeletion.mockResolvedValue(pendingDeletionDto(status));
    transport.recoverTask.mockRejectedValue(new Error('task_scope_forbidden'));
    await api.deleteThread('thread');
    expect(transport.recoverTask).not.toHaveBeenCalled();
    expect(transport.deleteMultiAgentThread).toHaveBeenCalledTimes(1);
    expect(transport.deleteMultiAgentThread).toHaveBeenCalledWith({ threadId: 'thread', expectedThreadRevision: 8,
      operationId: expect.stringMatching(/^delete:8:/), confirmTerminate: true });
    expect(transport.deleteMultiAgentThread.mock.calls[0][0].operationId).not.toBe('delete:7:prior-user-attempt');
    expect(db.deletion).toHaveBeenCalledWith('thread');
  });

  it('performs the first recover and reservation, then resumes the next explicit attempt without another recover', async () => {
    const db = storage(true, { currentTaskId: 'task_old', taskIds: ['task_old'] });
    const transport = desktop('cleanup_pending');
    await expect(api.deleteThread('thread')).rejects.toThrow(/pending/);
    expect(transport.recoverTask).toHaveBeenCalledTimes(1);
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ deletionPending: true }));
    expect(db.deletion).not.toHaveBeenCalled();
    const firstOperation = transport.deleteMultiAgentThread.mock.calls[0][0].operationId;
    const receipt = pendingDeletionDto('cleanup_pending'); receipt.operation!.operationId = firstOperation;
    transport.getMultiAgentThreadDeletion.mockResolvedValue(receipt);
    transport.deleteMultiAgentThread.mockImplementationOnce(async input => ({ operationId: input.operationId, state: 'completed' }));
    await api.deleteThread('thread');
    expect(transport.recoverTask).toHaveBeenCalledTimes(1);
    expect(transport.deleteMultiAgentThread).toHaveBeenCalledTimes(2);
    expect(transport.deleteMultiAgentThread.mock.calls[1][0]).toEqual({ threadId: 'thread', expectedThreadRevision: 8,
      operationId: expect.stringMatching(/^delete:8:/), confirmTerminate: true });
    expect(transport.deleteMultiAgentThread.mock.calls[1][0].operationId).not.toBe(firstOperation);
    expect(db.deletion).toHaveBeenCalledTimes(1);
  });

  it.each(['cleanup_pending', 'unknown'] as const)('keeps the reservation and local record when the resumed Main returns %s', async state => {
    const db = storage(true, { currentTaskId: 'task_old', taskIds: ['task_old'], deletionPending: true });
    const transport = desktop(state); transport.getMultiAgentThreadDeletion.mockResolvedValue(pendingDeletionDto('cleanup_pending'));
    await expect(api.deleteThread('thread')).rejects.toThrow(state === 'cleanup_pending' ? /pending/ : /unknown/);
    expect(transport.recoverTask).not.toHaveBeenCalled(); expect(transport.deleteMultiAgentThread).toHaveBeenCalledTimes(1);
    expect(db.deletion).not.toHaveBeenCalled();
    expect(await api.getThread('thread')).toMatchObject({ deletionPending: true, taskIds: ['task_old'] });
  });

  it.each(['no-reservation', 'none', 'no-operation', 'applied', 'queued_next_admission', 'completed'] as const)(
    'still requires recover when the pending conjunction is missing: %s', async boundary => {
      const db = storage(true, { currentTaskId: 'task_old', taskIds: ['task_old'], deletionPending: boundary !== 'no-reservation' });
      const transport = desktop('completed'), receipt = pendingDeletionDto('cleanup_pending');
      if (boundary === 'none') { receipt.deleteState = 'none'; receipt.operation = null; }
      else if (boundary === 'no-operation') receipt.operation = null;
      else if (boundary === 'applied' || boundary === 'queued_next_admission' || boundary === 'completed') receipt.operation!.state = boundary;
      transport.getMultiAgentThreadDeletion.mockResolvedValue(receipt);
      transport.recoverTask.mockRejectedValue(new Error('task_scope_forbidden'));
      await expect(api.deleteThread('thread')).rejects.toThrow(/unknown/);
      expect(transport.recoverTask).toHaveBeenCalledTimes(1);
      expect(transport.deleteMultiAgentThread).not.toHaveBeenCalled(); expect(db.deletion).not.toHaveBeenCalled();
    });

  it.each(['foreign-thread', 'negative-revision', 'fractional-revision'] as const)('rejects an invalid receipt before routing a retry: %s', async boundary => {
    const db = storage(true, { taskIds: ['task_old'], deletionPending: true }), transport = desktop('completed');
    const receipt = pendingDeletionDto('cleanup_pending');
    if (boundary === 'foreign-thread') receipt.threadId = 'other';
    else receipt.threadRevision = boundary === 'negative-revision' ? -1 : 1.5;
    transport.getMultiAgentThreadDeletion.mockResolvedValue(receipt);
    await expect(api.deleteThread('thread')).rejects.toThrow(/unknown/);
    expect(transport.recoverTask).not.toHaveBeenCalled(); expect(transport.deleteMultiAgentThread).not.toHaveBeenCalled();
    expect(db.deletion).not.toHaveBeenCalled();
  });

  it.each(['task-identity', 'reservation-lost'] as const)('rejects a change while reading the pending receipt: %s', async boundary => {
    const db = storage(true, { currentTaskId: 'task_old', taskIds: ['task_old'], deletionPending: true });
    const transport = desktop('completed');
    transport.getMultiAgentThreadDeletion.mockImplementationOnce(async () => {
      db.change(boundary === 'task-identity'
        ? { currentTaskId: 'task_new', taskIds: ['task_old', 'task_new'], deletionPending: true }
        : { currentTaskId: 'task_old', taskIds: ['task_old'], deletionPending: false });
      return pendingDeletionDto('cleanup_pending');
    });
    await expect(api.deleteThread('thread')).rejects.toThrow(/pending/);
    expect(transport.recoverTask).not.toHaveBeenCalled(); expect(transport.deleteMultiAgentThread).not.toHaveBeenCalled();
    expect(db.deletion).not.toHaveBeenCalled(); expect(db.put).not.toHaveBeenCalled();
  });

  it('retains changed local task identity even if Main completed the resumed attempt', async () => {
    const db = storage(true, { currentTaskId: 'task_old', taskIds: ['task_old'], deletionPending: true });
    const transport = desktop('completed'); transport.getMultiAgentThreadDeletion.mockResolvedValue(pendingDeletionDto('cleanup_pending'));
    transport.deleteMultiAgentThread.mockImplementationOnce(async input => {
      db.change({ currentTaskId: 'task_new', taskIds: ['task_new'], deletionPending: true });
      return { operationId: input.operationId, state: 'completed' };
    });
    await expect(api.deleteThread('thread')).rejects.toThrow(/pending/);
    expect(transport.recoverTask).not.toHaveBeenCalled(); expect(db.deletion).not.toHaveBeenCalled();
    expect(await api.getThread('thread')).toMatchObject({ currentTaskId: 'task_new', deletionPending: true });
  });

  it.each(['receipt-read', 'main-mutation'] as const)('cannot turn a rejected %s IPC into a local deletion', async boundary => {
    const db = storage(true, { taskIds: ['task_old'], deletionPending: true }), transport = desktop('completed');
    transport.getMultiAgentThreadDeletion.mockResolvedValue(pendingDeletionDto('cleanup_pending'));
    if (boundary === 'receipt-read') transport.getMultiAgentThreadDeletion.mockRejectedValueOnce(new Error('multi_agent_unauthorized_sender'));
    else transport.deleteMultiAgentThread.mockRejectedValueOnce(new Error('multi_agent_unauthorized_sender'));
    await expect(api.deleteThread('thread')).rejects.toThrow(/unauthorized/);
    expect(db.deletion).not.toHaveBeenCalled();
    expect(await api.getThread('thread')).toMatchObject({ deletionPending: true });
    expect(transport.deleteMultiAgentThread).toHaveBeenCalledTimes(boundary === 'receipt-read' ? 0 : 1);
  });
});
