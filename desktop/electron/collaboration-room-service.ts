/**
 * CollaborationRoom semantic service (design §9, §12, §16.3).
 *
 * Electron main owns this service. The renderer never talks to the broker
 * directly: every room mutation goes through a semantic method here, and
 * user mutations are pinned to the local owner identity — renderer-supplied
 * requestSource / actor / scopes fields are ignored, never forwarded.
 *
 * Project truth in composed snapshots comes from KSwarm, never from room
 * event payloads (design §16.3: the composer must not treat event payloads
 * as project state).
 */
import { randomUUID } from 'node:crypto';

export interface CollaborationRoomActorContext {
  sessionId: string;
  requestSource: 'user';
  actor: { kind: 'user'; userId: string };
  allowedLogicalAgentIds: string[];
  issuedAt: string;
}

interface RoomProjectSagaJournalPort {
  prepare(input: { operationId: string; clientRequestKey: string; roomId: string; expectedRoomRevision: number; sourceMessageIds: string[] }): { ok: boolean; code?: string };
  markProjectObserved(operationId: string, projectId: string): unknown;
  markRoomEventObserved(operationId: string, projectionEventId: string): unknown;
  complete(operationId: string, options?: { outcome?: string }): unknown;
}

const LOCAL_OWNER_USER_ID = 'user.local';

function localOwnerContext(): CollaborationRoomActorContext {
  return {
    sessionId: 'desktop-main-user',
    requestSource: 'user',
    actor: { kind: 'user', userId: LOCAL_OWNER_USER_ID },
    allowedLogicalAgentIds: [],
    issuedAt: new Date().toISOString(),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function createCollaborationRoomService({
  brokerClient,
  kswarmClient,
  sagaJournal,
  wakeDispatcher,
}: {
  brokerClient: {
    createRoom: (input: unknown, ctx: unknown) => Promise<unknown>;
    archiveRoom: (input: unknown, ctx: unknown) => Promise<unknown>;
    updateRoomMembers: (input: unknown, ctx: unknown) => Promise<unknown>;
    sendRoomMessage: (input: unknown, ctx: unknown) => Promise<unknown>;
    markRoomSeen: (input: unknown, ctx: unknown) => Promise<unknown>;
    cancelDiscussion?: (input: unknown, ctx: unknown) => Promise<unknown>;
    getRoomSnapshot: (roomId: string) => Promise<unknown>;
    listRooms?: () => Promise<unknown>;
  };
  kswarmClient: {
    request: (path: string, init?: unknown) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  };
  sagaJournal?: RoomProjectSagaJournalPort;
  wakeDispatcher?: {
    dispatchMessage(input: { roomId: string; roomMessageId: string; logicalAgentIds: string[] }): Promise<unknown>;
  };
}) {
  /** Renderer identity fields are transport facts — strip them, pin the owner. */
  function userCtx(): CollaborationRoomActorContext {
    return localOwnerContext();
  }

  async function callBroker(method: keyof typeof brokerClient, input: unknown) {
    const fn = brokerClient[method] as (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>;
    try {
      const result = await fn(input, userCtx());
      if (result && typeof result === 'object' && result.ok === false) {
        return result;
      }
      return result;
    } catch {
      return { ok: false, code: 'broker_unavailable' };
    }
  }

  async function createRoom(input: Record<string, unknown>) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const memberAgentIds = input.memberAgentIds;
    if (!title || !Array.isArray(memberAgentIds)) {
      return { ok: false, code: 'room_input_invalid' };
    }
    return callBroker('createRoom', {
      title,
      memberAgentIds,
      ...(isNonEmptyString(input.description) ? { description: input.description } : {}),
      ...(isNonEmptyString(input.clientRequestKey) ? { clientRequestKey: input.clientRequestKey } : {}),
    });
  }

  async function archiveRoom(input: Record<string, unknown>) {
    if (!isNonEmptyString(input.roomId)) return { ok: false, code: 'room_input_invalid' };
    return callBroker('archiveRoom', {
      roomId: input.roomId,
      expectedRoomRevision: input.expectedRoomRevision,
    });
  }

  async function updateRoomMembers(input: Record<string, unknown>) {
    if (!isNonEmptyString(input.roomId)) return { ok: false, code: 'room_input_invalid' };
    return callBroker('updateRoomMembers', input);
  }

  async function sendMessage(input: Record<string, unknown>) {
    if (!isNonEmptyString(input.roomId)) return { ok: false, code: 'room_input_invalid' };
    const result = await callBroker('sendRoomMessage', input) as Record<string, unknown>;
    if (!wakeDispatcher || result?.ok === false || !result?.message || typeof result.message !== 'object') {
      return result;
    }
    const message = result.message as Record<string, unknown>;
    const responsePolicy = message.responsePolicy;
    if (responsePolicy !== 'mentioned' && responsePolicy !== 'team_once') return result;

    let logicalAgentIds: string[] = [];
    if (responsePolicy === 'mentioned') {
      logicalAgentIds = (Array.isArray(message.mentions) ? message.mentions : [])
        .filter((mention): mention is { kind: string; logicalAgentId: string } => (
          Boolean(mention) && typeof mention === 'object'
          && (mention as { kind?: unknown }).kind === 'agent'
          && isNonEmptyString((mention as { logicalAgentId?: unknown }).logicalAgentId)
        ))
        .map(mention => mention.logicalAgentId);
    } else {
      const snapshot = await brokerClient.getRoomSnapshot(input.roomId);
      logicalAgentIds = snapshot && typeof snapshot === 'object' && Array.isArray((snapshot as { members?: unknown[] }).members)
        ? ((snapshot as { members: Array<{ status?: string; subject?: { kind?: string; logicalAgentId?: string } }> }).members)
            .filter(member => member.status === 'active' && member.subject?.kind === 'agent' && isNonEmptyString(member.subject.logicalAgentId))
            .map(member => member.subject!.logicalAgentId!)
        : [];
    }
    await wakeDispatcher.dispatchMessage({
      roomId: input.roomId,
      roomMessageId: String(message.messageId),
      logicalAgentIds,
    });
    return result;
  }

  async function markRoomSeen(input: Record<string, unknown>) {
    if (!isNonEmptyString(input.roomId)) return { ok: false, code: 'room_input_invalid' };
    return callBroker('markRoomSeen', input);
  }

  async function cancelDiscussion(input: Record<string, unknown>) {
    if (!brokerClient.cancelDiscussion) {
      return { ok: false, code: 'room_input_invalid' };
    }
    return callBroker('cancelDiscussion', input);
  }

  interface RoomSnapshotShape {
    ok: boolean;
    code?: string;
    degraded?: boolean;
    room?: { roomId: string; status: string; revision?: number };
    members?: unknown[];
    messages?: Array<{
      messageId: string;
      kind: string;
      contextScope?: { kind: string; projectId?: string };
      sourceRef?: { projectId?: string; projectionEventId?: string };
    }>;
    projects?: string[];
  }

  /**
   * Compose the room snapshot. Project facts are fetched from KSwarm
   * (authoritative), never rebuilt from room event payloads.
   */
  async function getRoom(roomId: string) {
    let snapshot: RoomSnapshotShape;
    try {
      snapshot = (await brokerClient.getRoomSnapshot(roomId)) as RoomSnapshotShape;
    } catch {
      return { ok: false, code: 'broker_unavailable', degraded: true };
    }
    if (!snapshot || snapshot.ok === false) {
      return { ok: false, code: snapshot?.code ?? 'room_not_found', degraded: snapshot?.degraded };
    }

    const projectIds = Array.isArray(snapshot.projects)
      ? snapshot.projects
      : [
          ...new Set(
            (snapshot.messages ?? [])
              .map((message) => message.sourceRef?.projectId)
              .filter((projectId): projectId is string => typeof projectId === 'string')
          ),
        ];

    const projects: Array<Record<string, unknown>> = [];
    for (const projectId of projectIds) {
      try {
        const response = await kswarmClient.request(`/projects/${projectId}`);
        if (!response || response.ok !== true) continue;
        const body = (await response.json()) as { project?: Record<string, unknown> };
        if (body?.project) projects.push(body.project);
      } catch {
        // degraded: project facts simply stay absent rather than being
        // reconstructed from room event payloads
      }
    }

    return {
      ok: true,
      room: snapshot.room,
      members: snapshot.members ?? [],
      messages: snapshot.messages ?? [],
      projects,
    };
  }

  async function listRooms() {
    if (!brokerClient.listRooms) return { ok: false, code: 'broker_unavailable' };
    try {
      return await brokerClient.listRooms();
    } catch {
      return { ok: false, code: 'broker_unavailable' };
    }
  }

  /**
   * Validate that every source message belongs to the room before creating
   * a project from the discussion (design §8.2 step 3).
   */
  async function createProjectFromRoom(input: Record<string, unknown>) {
    const roomId = input.roomId;
    if (!isNonEmptyString(roomId)) return { ok: false, code: 'room_input_invalid' };
    const sourceMessageIds = Array.isArray(input.sourceMessageIds)
      ? (input.sourceMessageIds as unknown[]).filter(isNonEmptyString)
      : [];
    if (sourceMessageIds.length === 0) return { ok: false, code: 'room_input_invalid' };

    let snapshot: RoomSnapshotShape;
    try {
      snapshot = (await brokerClient.getRoomSnapshot(roomId)) as RoomSnapshotShape;
    } catch {
      return { ok: false, code: 'broker_unavailable' };
    }
    if (!snapshot || snapshot.ok === false) {
      return { ok: false, code: snapshot?.code ?? 'room_not_found' };
    }
    const knownMessageIds = new Set((snapshot.messages ?? []).map((message) => message.messageId));
    for (const messageId of sourceMessageIds) {
      if (!knownMessageIds.has(messageId)) {
        return { ok: false, code: 'room_message_not_found', messageId };
      }
    }

    const clientRequestKey = isNonEmptyString(input.clientRequestKey)
      ? input.clientRequestKey
      : `room-project:${randomUUID()}`;
    const operationId = `room-project-op:${randomUUID()}`;
    const expectedRoomRevision = Number(snapshot.room?.revision ?? 0);
    if (sagaJournal) {
      const prepared = sagaJournal.prepare({
        operationId,
        clientRequestKey,
        roomId,
        expectedRoomRevision,
        sourceMessageIds,
      });
      if (!prepared.ok && prepared.code !== 'room_project_operation_duplicate') {
        return { ok: false, code: prepared.code ?? 'room_project_operation_failed' };
      }
    }

    // The trusted user create is performed by the saga owner with a pinned
    // user context; KSwarm enforces room subset + lease on its side.
    const response = await kswarmClient.request('/projects/room-first', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        goal: input.goal,
        poAgent: input.poAgentId,
        members: input.memberAgentIds ?? [],
        primaryRoomId: roomId,
        sourceMessageIds,
        clientRequestKey,
        expectedRoomRevision,
        requestSource: 'user',
      }),
    });
    if (!response || response.ok !== true) {
      return { ok: false, code: 'kswarm_unavailable' };
    }
    const result = (await response.json()) as Record<string, unknown>;
    const project = result.project as { id?: string; roomEventOutbox?: Array<{ projectionEventId?: string; status?: string }> } | undefined;
    const projection = project?.roomEventOutbox?.[0];
    if (sagaJournal && project?.id) {
      sagaJournal.markProjectObserved(operationId, project.id);
      if (projection?.projectionEventId && projection.status === 'published') {
        sagaJournal.markRoomEventObserved(operationId, projection.projectionEventId);
        sagaJournal.complete(operationId);
      } else if (projection?.status === 'suppressed_room_archived') {
        sagaJournal.complete(operationId, { outcome: 'suppressed_room_archived' });
      }
    }
    return result;
  }

  async function createTaskFromRoomMessage(input: Record<string, unknown>) {
    const roomId = input.roomId;
    if (!isNonEmptyString(roomId) || !isNonEmptyString(input.messageId) || !isNonEmptyString(input.projectId)) {
      return { ok: false, code: 'room_input_invalid' };
    }
    let snapshot: RoomSnapshotShape;
    try {
      snapshot = (await brokerClient.getRoomSnapshot(roomId)) as RoomSnapshotShape;
    } catch {
      return { ok: false, code: 'broker_unavailable' };
    }
    if (!snapshot || snapshot.ok === false) {
      return { ok: false, code: snapshot?.code ?? 'room_not_found' };
    }
    const message = (snapshot.messages ?? []).find((item) => item.messageId === input.messageId);
    if (!message) return { ok: false, code: 'room_message_not_found' };
    // the message must belong to the project's primary room scope
    if (message.sourceRef?.projectId && message.sourceRef.projectId !== input.projectId) {
      return { ok: false, code: 'room_scope_mismatch' };
    }

    const response = await kswarmClient.request(`/projects/${input.projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        brief: input.brief,
        sourceRoomId: roomId,
        sourceMessageId: input.messageId,
        requestSource: 'user',
      }),
    });
    if (!response || response.ok !== true) {
      return { ok: false, code: 'kswarm_unavailable' };
    }
    return (await response.json()) as Record<string, unknown>;
  }

  return {
    createRoom,
    archiveRoom,
    updateRoomMembers,
    sendMessage,
    markRoomSeen,
    cancelDiscussion,
    getRoom,
    listRooms,
    createProjectFromRoom,
    createTaskFromRoomMessage,
  };
}
