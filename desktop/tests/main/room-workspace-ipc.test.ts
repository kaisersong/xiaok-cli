import { describe, expect, it, vi } from 'vitest';
import { registerRoomWorkspaceIpc, ROOM_WORKSPACE_CHANNELS } from '../../electron/room-workspace-ipc.js';
describe('workspace semantic IPC', () => {
  it('all entry points reject an untrusted frame before reaching the authenticated service', async () => {
    const handlers = new Map<string, Function>(); const invoke = vi.fn();
    const service = Object.fromEntries(Object.keys(ROOM_WORKSPACE_CHANNELS).map(key => [key, invoke]));
    registerRoomWorkspaceIpc({ handle: (name: string, callback: Function) => handlers.set(name, callback) } as never, service as never, () => false);
    for (const handler of handlers.values()) expect(await handler({}, { roomId: 'r', requestSource: 'user' })).toMatchObject({ ok: false, code: 'workspace_ipc_forbidden' });
    expect(invoke).not.toHaveBeenCalled(); expect(handlers.size).toBe(11);
  });
  it('uses fixed semantic channels only and emits a refresh after completed mutation', async () => {
    const handlers = new Map<string, Function>(); const notify = vi.fn();
    const method = vi.fn(async () => ({ ok: true }));
    registerRoomWorkspaceIpc({ handle: (name: string, callback: Function) => handlers.set(name, callback) } as never, { commitCollaborationRoomWorkspace: method } as never, () => true, notify);
    await handlers.get(ROOM_WORKSPACE_CHANNELS.commitCollaborationRoomWorkspace)!({}, { roomId: 'r', previewId: 'p' });
    expect(method).toHaveBeenCalledTimes(1); expect(notify).toHaveBeenCalledWith({ type: 'workspace_changed', kind: 'workspace_changed', roomId: 'r' });
  });
});
