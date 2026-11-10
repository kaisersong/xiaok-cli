import { vi } from 'vitest';

export function createThreadDeletionTransportFixture(state: { desktop: Record<string, unknown> | null }) {
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

  return { storage, desktop };
}
