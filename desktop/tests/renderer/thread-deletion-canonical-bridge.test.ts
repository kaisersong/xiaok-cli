import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../renderer/src/api/bridge';
import { createThreadDeletionTransportFixture } from '../fixtures/thread-deletion-transport';

const state = vi.hoisted(() => ({ desktop: null as Record<string, unknown> | null }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => state.desktop, isDesktop: () => true }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); state.desktop = null; });
const { storage, desktop } = createThreadDeletionTransportFixture(state);

describe('canonical thread deletion uses the current Main receipt owner', () => {
  it('Given a canonical conversation without an IndexedDB shadow, Then deletion still verifies task binding and the original Main receipt', async () => {
    const db = storage(); const transport = desktop('completed'); let removed = false;
    const record = { id: 'thread', title: 'Main-owned', currentTaskId: 'task_real', taskIds: ['task_real'], coverage: 'complete', createdAt: 1, updatedAt: 1, mode: 'chat', starred: false, gtdBucket: null, pinnedAt: null, status: 'completed', revision: 1 };
    state.desktop!.getContextConversation = vi.fn(async () => removed ? null : record);
    transport.deleteMultiAgentThread.mockImplementation(async input => { removed = true; return { operationId: input.operationId, state: 'completed' }; });
    await api.deleteThread('thread');
    expect(transport.recoverTask).toHaveBeenCalledWith('task_real');
    expect(transport.deleteMultiAgentThread).toHaveBeenCalledTimes(1);
    expect(db.put).not.toHaveBeenCalled(); expect(db.deletion).toHaveBeenCalledWith('thread');
  });
  it('Given a canonical conversation and a foreign Main receipt, Then deletion never dispatches or removes local metadata', async () => {
    const db = storage(); const transport = desktop('completed');
    state.desktop!.getContextConversation = vi.fn(async () => ({ id: 'thread', taskIds: [], currentTaskId: null, coverage: 'complete' }));
    transport.getMultiAgentThreadDeletion.mockResolvedValue({ threadId: 'foreign', threadRevision: 7, deleteState: 'none', operation: null });
    await expect(api.deleteThread('thread')).rejects.toThrow(/unknown/);
    expect(transport.deleteMultiAgentThread).not.toHaveBeenCalled(); expect(db.deletion).not.toHaveBeenCalled();
  });
  it.each(['cleanup_pending', 'unknown'])('Given a canonical conversation and Main %s, Then canonical and local data are retained', async status => {
    const db = storage(); const transport = desktop(status);
    state.desktop!.getContextConversation = vi.fn(async () => ({ id: 'thread', taskIds: [], currentTaskId: null, coverage: 'complete' }));
    await expect(api.deleteThread('thread')).rejects.toThrow(status === 'unknown' ? /unknown/ : /pending/);
    expect(transport.deleteMultiAgentThread).toHaveBeenCalledTimes(1); expect(db.deletion).not.toHaveBeenCalled();
  });

});
