import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../renderer/src/api/bridge';
import { ASSISTANT_THREAD_ID } from '../../renderer/src/lib/assistant-thread';
import { createThreadDeletionTransportFixture } from '../fixtures/thread-deletion-transport';

// #233 (c), 东八区 18:3x: Main's deletion entry refuses with continuity_unavailable
// before delete_pending. The bridge's own reservation (deletionPending) must be
// undone so the session's send path does not report thread_deletion_pending.
// Production path: api.deleteThread -> (fake) Main rejects exactly as Electron
// IPC rethrows a Main error -> api.ensureAssistantWorkThread / ensureAssistantThread
// (bridge.ts send entries). IndexedDB is the repo's transport double; no test sets the flag.
const state = vi.hoisted(() => ({ desktop: null as Record<string, unknown> | null }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => state.desktop, isDesktop: () => true }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); state.desktop = null; });
const { storage } = createThreadDeletionTransportFixture(state);

const WORK_THREAD = 'a0c22222-2222-4222-8222-222222222222';
const ipcError = (code: string) => new Error(`Error invoking remote method 'desktop:deleteMultiAgentThread': Error: ${code}`);
function mainRefusing(threadId: string, code: string) {
  const getMultiAgentThreadDeletion = vi.fn(async () => ({ threadId, threadRevision: 3, deleteState: 'none', operation: null }));
  const deleteMultiAgentThread = vi.fn(async () => { throw ipcError(code); });
  const recoverTask = vi.fn(async () => ({ snapshot: { context: { threadId } } }));
  const getContextConversation = vi.fn(async () => null);
  state.desktop = { getMultiAgentThreadDeletion, deleteMultiAgentThread, recoverTask, getContextConversation };
  return { deleteMultiAgentThread };
}

describe('Main refuses deletion with continuity_unavailable', () => {
  it('work thread: the local reservation is undone and the send path (ensureAssistantWorkThread) is not blocked', async () => {
    const db = storage(true, { taskIds: ['task_old'], currentTaskId: 'task_old' }); const main = mainRefusing(WORK_THREAD, 'continuity_unavailable');
    await expect(api.deleteThread(WORK_THREAD)).rejects.toThrow(/continuity_unavailable$/);
    expect(main.deleteMultiAgentThread).toHaveBeenCalledTimes(1);
    // The bridge reserved before calling Main, then undid it on the refusal.
    expect(db.put).toHaveBeenNthCalledWith(1, expect.objectContaining({ deletionPending: true }));
    expect(db.put).toHaveBeenLastCalledWith(expect.not.objectContaining({ deletionPending: expect.anything() }));
    expect(db.deletion).not.toHaveBeenCalled();
    await expect(api.ensureAssistantWorkThread({ id: WORK_THREAD, title: 'work', taskId: 'task_next' })).resolves.toMatchObject({ currentTaskId: 'task_next' });
    expect(db.put).toHaveBeenLastCalledWith(expect.objectContaining({ taskIds: ['task_old', 'task_next'], currentTaskId: 'task_next' }));
    expect(db.put).toHaveBeenLastCalledWith(expect.not.objectContaining({ deletionPending: expect.anything() }));
  });
  it('assistant thread: the send path (ensureAssistantThread) is not blocked after the refusal', async () => {
    const db = storage(true, { taskIds: ['task_old'], currentTaskId: 'task_old' }); mainRefusing(ASSISTANT_THREAD_ID, 'continuity_unavailable');
    await expect(api.deleteThread(ASSISTANT_THREAD_ID)).rejects.toThrow(/continuity_unavailable$/);
    expect(db.put).toHaveBeenNthCalledWith(1, expect.objectContaining({ deletionPending: true }));
    await expect(api.ensureAssistantThread('assistant')).resolves.toMatchObject({ taskIds: ['task_old'] });
    expect(db.put).toHaveBeenLastCalledWith(expect.not.objectContaining({ deletionPending: expect.anything() }));
  });
  it('a reservation that existed before this attempt is kept (only this attempt is undone)', async () => {
    const db = storage(true, { taskIds: [], deletionPending: true });
    const main = mainRefusing(WORK_THREAD, 'continuity_unavailable');
    state.desktop!.getMultiAgentThreadDeletion = vi.fn(async () => ({ threadId: WORK_THREAD, threadRevision: 3, deleteState: 'delete_pending', operation: { operationId: 'delete:3:old', state: 'unknown' } }));
    await expect(api.deleteThread(WORK_THREAD)).rejects.toThrow(/continuity_unavailable$/);
    expect(main.deleteMultiAgentThread).toHaveBeenCalledTimes(1);
    expect(db.put).toHaveBeenLastCalledWith(expect.objectContaining({ deletionPending: true }));
    await expect(api.ensureAssistantWorkThread({ id: WORK_THREAD, title: 'work', taskId: 'task_next' })).rejects.toThrow('thread_deletion_pending');
  });
  it.each(['multi_agent_runtime_not_ready', 'stale thread deletion revision'])('any other Main refusal (%s) keeps the reservation as before', async code => {
    const db = storage(true, { taskIds: [] }); mainRefusing(WORK_THREAD, code);
    await expect(api.deleteThread(WORK_THREAD)).rejects.toThrow(code);
    expect(db.put).toHaveBeenCalledTimes(1); expect(db.put).toHaveBeenLastCalledWith(expect.objectContaining({ deletionPending: true }));
    await expect(api.ensureAssistantWorkThread({ id: WORK_THREAD, title: 'work', taskId: 'task_next' })).rejects.toThrow('thread_deletion_pending');
  });
  it('degraded continuity IPC: the bridge first continuity read is refused, so nothing is reserved and Main is not called', async () => {
    // electron/ipc.ts registers the continuity channels on services.continuity.port(),
    // which throws continuity_unavailable on a degraded root (context-continuity/ipc.ts trusted()).
    const db = storage(true, { taskIds: [] }); const main = mainRefusing(WORK_THREAD, 'continuity_unavailable');
    state.desktop!.getContextConversation = vi.fn(async () => { throw new Error("Error invoking remote method 'desktop:context:getConversation': Error: continuity_unavailable"); });
    await expect(api.deleteThread(WORK_THREAD)).rejects.toThrow(/continuity_unavailable$/);
    expect(db.put).not.toHaveBeenCalled(); expect(main.deleteMultiAgentThread).not.toHaveBeenCalled();
  });
});
