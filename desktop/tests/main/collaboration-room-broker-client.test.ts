import { describe, it, expect, vi } from 'vitest';
import { createCollaborationRoomBrokerClient } from '../../electron/collaboration-room-broker-client.js';

// design §6.2 RoomHistoryReadCapability：agent-internal listRoomMessagesPage
// wrapper. Not exposed to renderer preload; used by the wake dispatcher (or
// a future agent-facing tool) to page through room history on demand.
//
// 2026-09-02 更新：调用改为 POST /room-wakes/history-page（claim-token-bound，
// intent-broker 侧新增端点），不再调用宽松鉴权的
// GET /rooms/:roomId/messages——那条路径与 agent 的 wake claim 身份完全无关。
describe('collaboration room broker client — listRoomMessagesPage', () => {
  function createFetchFake(capture: { url?: string; init?: RequestInit }) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      capture.url = url;
      capture.init = init;
      return {
        ok: true,
        json: async () => ({ ok: true, messages: [], totalMessages: 0 }),
      } as unknown as Response;
    });
  }

  it('POSTs to /room-wakes/history-page with claimToken and roomId in the body', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = createCollaborationRoomBrokerClient({ token: 'tok', fetchImpl: createFetchFake(capture) });

    await client.listRoomMessagesPage({ roomId: 'room-1', claimToken: 'claim-token-1' });

    expect(capture.url).toBe('http://127.0.0.1:4318/room-wakes/history-page');
    expect(capture.init?.method).toBe('POST');
    const body = JSON.parse(capture.init?.body as string);
    expect(body).toEqual({ claimToken: 'claim-token-1', roomId: 'room-1' });
  });

  it('includes afterSequence, beforeSequence, and limit in the body when provided', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = createCollaborationRoomBrokerClient({ token: 'tok', fetchImpl: createFetchFake(capture) });

    await client.listRoomMessagesPage({ roomId: 'room-1', claimToken: 'claim-token-1', afterSequence: 10, beforeSequence: 50, limit: 20 });

    const body = JSON.parse(capture.init?.body as string);
    expect(body).toEqual({
      claimToken: 'claim-token-1',
      roomId: 'room-1',
      afterSequence: 10,
      beforeSequence: 50,
      limit: 20,
    });
  });

  it('sends the room-token header, not a generic Authorization header', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = createCollaborationRoomBrokerClient({ token: 'secret-token', fetchImpl: createFetchFake(capture) });

    await client.listRoomMessagesPage({ roomId: 'room-1', claimToken: 'claim-token-1', limit: 5 });

    const headers = capture.init?.headers as Record<string, string>;
    expect(headers['x-intent-broker-room-token']).toBe('secret-token');
  });

  it('does not leak claimToken into the URL (it is only in the POST body)', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = createCollaborationRoomBrokerClient({ token: 'tok', fetchImpl: createFetchFake(capture) });

    await client.listRoomMessagesPage({ roomId: 'room-1', claimToken: 'super-secret-claim-token', limit: 5 });

    expect(capture.url).not.toContain('super-secret-claim-token');
  });
});
