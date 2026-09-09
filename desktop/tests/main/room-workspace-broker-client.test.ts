import { describe, expect, it, vi } from 'vitest';
import { createRoomWorkspaceBrokerClient } from '../../electron/room-workspace-broker-client.js';
describe('workspace authenticated main-only broker transport', () => {
  it('registers one owner incarnation and carries it outside untrusted bodies', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => ({ json: async () => init?.body?.toString().includes('startupId') ? { ok: true, host: { hostId: 'h1', hostIncarnation: 8 } } : { ok: true, config: null } }) as Response);
    const client = createRoomWorkspaceBrokerClient({ token: 'private-token', fetchImpl, isMutationOwner: () => true });
    await client.get('r1'); await client.request('r1', 'begin-change', { expectedRevision: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2][1]?.headers).toMatchObject({ 'x-intent-broker-host-incarnation': '8', 'x-intent-broker-room-token': 'private-token' });
  });
  it('second physical owner cannot fence a live owner by registering a new incarnation', async () => {
    const fetchImpl = vi.fn();
    const client = createRoomWorkspaceBrokerClient({ token: 't', fetchImpl, isMutationOwner: () => false });
    await expect(client.get('r')).rejects.toThrow('workspace_mutation_owner_busy'); expect(fetchImpl).not.toHaveBeenCalled();
  });
});
