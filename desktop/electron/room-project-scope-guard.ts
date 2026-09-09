import type { RoomWorkspaceBrokerPort } from './room-workspace-service.js';

type Result = Record<string, unknown>;
type RoomPort = {
  getRoomSnapshot(roomId: string): Promise<Result>;
  claimWake(input: any): Promise<Result>;
  completeWake(input: any): Promise<Result>;
  listRoomMessagesPage(input: any): Promise<Result>;
};
const object = (value: unknown): value is Result => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** No permission cache: each agent operation checks both current authorities. */
export function createRoomProjectScopeGuard<R extends RoomPort, W extends RoomWorkspaceBrokerPort>(options: {
  roomClient: R;
  workspaceBroker: W;
  kswarmRequest(path: string, init?: RequestInit): Promise<{ ok: boolean; json(): Promise<unknown> }>;
}) {
  async function authorize(roomId: unknown, roomMessageId: unknown, logicalAgentId: unknown, signal: AbortSignal) {
    if (!nonempty(roomId) || !nonempty(roomMessageId) || !nonempty(logicalAgentId)) throw new Error('room_project_identity_required');
    const snapshot = await options.roomClient.getRoomSnapshot(roomId);
    signal.throwIfAborted();
    if (!snapshot.ok || !object(snapshot.room) || snapshot.room.roomId !== roomId) throw new Error('broker_unavailable');
    const source = Array.isArray(snapshot.messages) ? snapshot.messages.find(message => object(message) && message.messageId === roomMessageId && message.roomId === roomId) : undefined;
    if (!object(source)) throw new Error('room_message_not_found');
    const scope = source.contextScope ?? { kind: 'room_only' };
    if (!object(scope)) throw new Error('room_scope_mismatch');
    if (scope.kind === 'room_only') return;
    if (scope.kind !== 'project' || !nonempty(scope.projectId)) throw new Error('room_scope_mismatch');
    const response = await options.kswarmRequest(`/projects/${encodeURIComponent(scope.projectId)}/workspace-mapping?logicalAgentId=${encodeURIComponent(logicalAgentId)}`, { signal });
    const result = await response.json();
    signal.throwIfAborted();
    if (!response.ok || !object(result) || result.ok !== true || !object(result.project)) throw new Error(object(result) && nonempty(result.error) ? result.error : 'room_project_authorization_unavailable');
    const project = result.project;
    if (project.id !== scope.projectId || project.primaryRoomId !== roomId || project.status === 'archived' || project.archived === true) throw new Error('room_project_access_denied');
    // Membership (including canonical agent IDs) belongs to this KSwarm
    // endpoint. Do not clone its policy or persist a shadow grant here.
  }
  async function guarded(input: unknown, token: boolean, invoke: () => Promise<Result>) {
    try {
      if (!object(input)) throw new Error('room_input_invalid');
      const parts = token && typeof input.claimToken === 'string' ? input.claimToken.split('|') : [];
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          authorize(input.roomId, token ? parts[0] : input.roomMessageId, token ? parts[1] : input.logicalAgentId, controller.signal),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { const error = new Error('room_project_authorization_timeout'); controller.abort(error); reject(error); }, 15_000); }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
      return await invoke();
    } catch (error) { return { ok: false, code: error instanceof Error ? error.message : 'room_project_authorization_unavailable' }; }
  }
  return {
    roomClient: {
      ...options.roomClient,
      claimWake: (input: unknown) => guarded(input, false, () => {
        const value = input as Result;
        return options.workspaceBroker.request(value.roomId as string, 'claim-wake', { roomMessageId: value.roomMessageId, logicalAgentId: value.logicalAgentId, hostParticipantId: value.hostParticipantId, discussionOnly: true });
      }),
      abandonWake: (input: { roomId: string; claimToken: string; reason?: string }) => {
        if (!nonempty(input?.roomId) || !nonempty(input?.claimToken)) return Promise.resolve({ ok: false, code: 'room_input_invalid' });
        return options.workspaceBroker.request(input.roomId, 'abandon-wake', { claimToken: input.claimToken, reason: 'execution_failed' });
      },
      completeWake: (input: unknown) => guarded(input, true, () => options.roomClient.completeWake(input)),
      listRoomMessagesPage: (input: unknown) => guarded(input, true, () => options.roomClient.listRoomMessagesPage(input)),
    } as R & { abandonWake(input: { roomId: string; claimToken: string; reason?: string }): Promise<Result> },
    workspaceBroker: {
      ...options.workspaceBroker,
      request: (roomId: string, action: string, input: Result) => action === 'claim-wake'
        ? guarded({ ...input, roomId }, false, () => options.workspaceBroker.request(roomId, action, input))
        : options.workspaceBroker.request(roomId, action, input),
    } as W,
  };
}
