import { describe, expect, it, vi } from 'vitest';
import { createRoomWorkspaceProjectDispatch } from '../../electron/room-workspace-project-dispatch.js';

describe('workspace existing project dispatch button boundary', () => {
  it('coalesces double clicks and dispatches only authoritative existing candidates', async () => {
    let unblock!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const listDispatchCandidates = vi.fn(async () => { await gate; return { roomId: 'r', tasks: [{ taskId: 'p__a', logicalAgentId: 'worker' }] }; });
    const prepareProjectTask = vi.fn(async () => ({ ok: true, runId: 'run' }));
    const dispatch = createRoomWorkspaceProjectDispatch({ adapter: { listDispatchCandidates }, runtime: { prepareProjectTask } });
    const first = dispatch('p', {}), second = dispatch('p', {});
    expect(first).toBe(second); unblock();
    expect(await first).toMatchObject({ ok: true, dispatched: ['p__a'] });
    expect(listDispatchCandidates).toHaveBeenCalledTimes(1);
    expect(prepareProjectTask).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'r', projectId: 'p', taskId: 'p__a', logicalAgentId: 'worker', requestId: expect.any(String) }));
  });
  it('only falls through for an authoritative legacy project, never on offline or v1 failures', async () => {
    const runtime = { prepareProjectTask: vi.fn() };
    expect(await createRoomWorkspaceProjectDispatch({ adapter: { listDispatchCandidates: async () => null }, runtime })('old', {})).toBeNull();
    await expect(createRoomWorkspaceProjectDispatch({ adapter: { listDispatchCandidates: async () => { throw new Error('offline'); } }, runtime })('v1', {})).rejects.toThrow('offline');
    expect(runtime.prepareProjectTask).not.toHaveBeenCalled();
  });
  it('reports partial dispatch without losing successes or pretending pending failures completed', async () => {
    const dispatch = createRoomWorkspaceProjectDispatch({ adapter: { listDispatchCandidates: async () => ({ roomId: 'r', tasks: [{ taskId: 'a', logicalAgentId: 'one' }, { taskId: 'b', logicalAgentId: 'two' }] }) }, runtime: { prepareProjectTask: async input => { if (input.taskId === 'b') throw new Error('workspace_dispatch_pending'); return { ok: true }; } } });
    expect(await dispatch('p', {})).toMatchObject({ ok: false, dispatched: ['a'], failed: [{ taskId: 'b', code: 'workspace_dispatch_pending' }] });
  });
});
