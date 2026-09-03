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
    // design §6.2：agent-internal 语义 wrapper，供
    // collaboration-room-wake-dispatcher.ts 在唤醒执行期间按需补取历史使用。
    // 不暴露给 renderer preload（renderer 走既有的 getRoomSnapshot/getRoom
    // 全量 UI 快照路径）。
    //
    // design §6.2 RoomHistoryReadCapability：调用专用的 claim-token-bound
    // POST /room-wakes/history-page 端点（intent-broker 侧新增，2026-09-02），
    // 不调用宽松鉴权的 GET /rooms/:roomId/messages——那条路径走的是
    // desktop-main-user/kswarm-system ctx，与 agent 的 wake claim 身份完全
    // 无关，不满足"claim token 派生 roomId 并与请求绑定 roomId 比较，再核对
    // exact delivery token、wakeStatus='claimed'、active member/room 和
    // current discussion epoch"的要求。
    listRoomMessagesPage: (input: {
      roomId: string;
      claimToken: string;
      afterSequence?: number;
      beforeSequence?: number;
      limit?: number;
    }) => json('POST', '/room-wakes/history-page', {
      claimToken: input.claimToken,
      roomId: input.roomId,
      ...(input.afterSequence !== undefined ? { afterSequence: input.afterSequence } : {}),
      ...(input.beforeSequence !== undefined ? { beforeSequence: input.beforeSequence } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
  };
}
