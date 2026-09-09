// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRoomProjectScopeGuard } from '../../electron/room-project-scope-guard.js';
async function fixture() {
  const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
  const { createHub } = await nativeImport(pathToFileURL(join(resolve(process.cwd(), '../..'), 'kswarm/src/core/hub.js')).href);
  const hub = createHub({ silent: true }); const project = hub.createProject({ id: 'p', name: 'p', goal: 'g', poAgent: 'po', members: ['a'] }); project.primaryRoomId = 'r';
  const room = { ok: true, room: { roomId: 'r' }, messages: [{ roomId: 'r', messageId: 'm', contextScope: { kind: 'project', projectId: 'p' } }] };
  const client = { getRoomSnapshot: vi.fn(async () => room), claimWake: vi.fn(async () => ({ ok: true })), completeWake: vi.fn(async () => ({ ok: true })), listRoomMessagesPage: vi.fn(async () => ({ ok: true, messages: [] })) };
  const workspace = { get: vi.fn(), request: vi.fn(async () => ({ ok: true })) };
  const request = vi.fn(async (path: string) => { const url = new URL(path, 'http://fixture'); const result = hub.getWorkspaceMapping('p', undefined, url.searchParams.get('logicalAgentId')); return { ok: true, json: async () => result }; });
  return { hub, project, room, client, workspace, request, guard: createRoomProjectScopeGuard({ roomClient: client, workspaceBroker: workspace, kswarmRequest: request }) };
}
describe('project discussion realtime guard', () => {
  it('host-bound admission and cleanup use workspace authority without a new project read', async () => {
    const f = await fixture();
    try {
      expect((await f.guard.roomClient.claimWake({ roomId: 'r', roomMessageId: 'm', logicalAgentId: 'a' })).ok).toBe(true);
      expect(f.client.claimWake).not.toHaveBeenCalled();
      f.request.mockRejectedValue(new Error('revoked'));
      const reads = f.request.mock.calls.length;
      expect((await f.guard.roomClient.abandonWake({ roomId: 'r', claimToken: 'm|a|1|expiry' })).ok).toBe(true);
      expect(f.request).toHaveBeenCalledTimes(reads);
      expect(f.workspace.request).toHaveBeenLastCalledWith('r', 'abandon-wake', { claimToken: 'm|a|1|expiry', reason: 'execution_failed' });
    } finally { f.hub.closePersistence(); }
  });
  it.each(['room', 'kswarm'])('times out a never-settling %s authority without admitting work later', async authority => {
    const f = await fixture(); vi.useFakeTimers();
    try {
      let resolveRead!: (value: any) => void; const pending = new Promise<any>(resolve => { resolveRead = resolve; });
      if (authority === 'room') f.client.getRoomSnapshot.mockImplementation(() => pending); else f.request.mockImplementation(() => pending);
      const result = f.guard.roomClient.claimWake({ roomId: 'r', roomMessageId: 'm', logicalAgentId: 'a' });
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await result).ok).toBe(false); expect(f.client.claimWake).not.toHaveBeenCalled();
      resolveRead(authority === 'room' ? f.room : { ok: true, json: async () => ({ ok: true, project: f.project }) });
      await Promise.resolve(); expect(f.client.claimWake).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); f.hub.closePersistence(); }
  });
  it('checks real KSwarm membership freshly for claim, page and complete without file/task mutations', async () => {
    const f = await fixture();
    try {
      expect((await f.guard.workspaceBroker.request('r', 'claim-wake', { roomMessageId: 'm', logicalAgentId: 'a', discussionOnly: true })).ok).toBe(true);
      expect((await f.guard.roomClient.listRoomMessagesPage({ roomId: 'r', claimToken: 'm|a|1|expiry' })).ok).toBe(true);
      expect((await f.guard.roomClient.completeWake({ roomId: 'r', claimToken: 'm|a|1|expiry' })).ok).toBe(true);
      expect(f.request).toHaveBeenCalledTimes(3); expect(f.workspace.request.mock.calls.map(c => c[1])).toEqual(['claim-wake']);
    } finally { f.hub.closePersistence(); }
  });
  it('fails closed after live membership revocation and does not trust caller scope or identity', async () => {
    const f = await fixture();
    try {
      await f.guard.workspaceBroker.request('r', 'claim-wake', { roomMessageId: 'm', logicalAgentId: 'a', discussionOnly: true }); f.project.members = [];
      const result = await f.guard.roomClient.completeWake({ roomId: 'r', claimToken: 'm|a|1|expiry', logicalAgentId: 'po', contextScope: { kind: 'room_only' } });
      expect(result.ok).toBe(false); expect(f.client.completeWake).not.toHaveBeenCalled();
      expect((await f.guard.roomClient.listRoomMessagesPage({ roomId: 'r', claimToken: 'm|a|1|expiry' })).ok).toBe(false);
      expect(f.client.listRoomMessagesPage).not.toHaveBeenCalled();
    } finally { f.hub.closePersistence(); }
  });
  it.each(['disconnect', 'wrong-room', 'missing-source'])('denies %s before legacy and workspace wake admission', async failure => {
    const f = await fixture();
    try {
      if (failure === 'disconnect') f.request.mockRejectedValue(new Error('offline'));
      if (failure === 'wrong-room') f.project.primaryRoomId = 'other';
      if (failure === 'missing-source') f.room.messages = [];
      const input = { roomId: 'r', roomMessageId: 'm', logicalAgentId: 'a' };
      expect((await f.guard.roomClient.claimWake(input)).ok).toBe(false);
      expect((await f.guard.workspaceBroker.request('r', 'claim-wake', input)).ok).toBe(false);
      expect(f.client.claimWake).not.toHaveBeenCalled(); expect(f.workspace.request).not.toHaveBeenCalled();
    } finally { f.hub.closePersistence(); }
  });
});
