const BROKER_BASE_URLS = ['http://127.0.0.1:4318', 'http://localhost:4318'];
const ROOM_TOKEN_HEADER = 'x-intent-broker-room-token';

export function createCollaborationRoomBrokerClient(options: {
  token: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let lastError: unknown = null;
    for (const baseUrl of BROKER_BASE_URLS) {
      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          ...init,
          headers: {
            [ROOM_TOKEN_HEADER]: options.token,
            ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(init.headers ?? {}),
          },
        });
        const payload = await response.json() as Record<string, unknown>;
        return payload;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('broker_unavailable');
  }

  const json = (method: string, path: string, input: unknown) => request(path, {
    method,
    body: JSON.stringify(input ?? {}),
  });
  const roomIdFrom = (input: unknown) => (
    input && typeof input === 'object' && typeof (input as { roomId?: unknown }).roomId === 'string'
      ? (input as { roomId: string }).roomId
      : ''
  );

  return {
    createRoom: (input: unknown) => json('POST', '/rooms', input),
    archiveRoom: (input: unknown) => json('POST', `/rooms/${encodeURIComponent(roomIdFrom(input))}/archive`, input),
    updateRoomMembers: (input: unknown) => json('PUT', `/rooms/${encodeURIComponent(roomIdFrom(input))}/members`, input),
    sendRoomMessage: (input: unknown) => json('POST', `/rooms/${encodeURIComponent(roomIdFrom(input))}/messages`, input),
    markRoomSeen: (input: unknown) => json('POST', `/rooms/${encodeURIComponent(roomIdFrom(input))}/seen`, input),
    listPendingWakes: (logicalAgentId: string) => request(`/room-wakes?logicalAgentId=${encodeURIComponent(logicalAgentId)}`),
    claimWake: (input: unknown) => json('POST', '/room-wakes/claim', input),
    completeWake: (input: unknown) => json('POST', '/room-wakes/complete', input),
    getRoomSnapshot: (roomId: string) => request(`/rooms/${encodeURIComponent(roomId)}`),
    listRooms: () => request('/rooms'),
  };
}
