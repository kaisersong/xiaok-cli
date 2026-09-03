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
import { basename } from 'node:path';
import type { CollaborationRoomDispatchEvent } from './collaboration-room-wake-dispatcher.js';
import { XIAOK_WORKER_SEED_ID } from '../shared/kswarm-seed-contract.js';

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
const MAX_ROOM_ATTACHMENTS = 20;
const MAX_ROOM_ATTACHMENT_PATH_LENGTH = 4096;
const ROOM_MENTION_BOUNDARY = '[\\s，。！？、,.;:!?）)\\]】}\\}]';

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

function activeAgentIdsFromSnapshot(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray((snapshot as { members?: unknown }).members)) return [];
  return [...new Set((snapshot as {
    members: Array<{ status?: unknown; subject?: { kind?: unknown; logicalAgentId?: unknown } }>;
  }).members
    .filter(member => member.status === 'active'
      && member.subject?.kind === 'agent'
      && isNonEmptyString(member.subject.logicalAgentId))
    .map(member => member.subject!.logicalAgentId as string))];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsRoomMention(text: string, logicalAgentId: string): boolean {
  return new RegExp(`(^|\\s)@${escapeRegExp(logicalAgentId)}(?=$|${ROOM_MENTION_BOUNDARY})`, 'u').test(text);
}

function canonicalRoomRoute(text: string, activeAgentIds: string[]): {
  mentions: Array<{ kind: 'all' } | { kind: 'agent'; logicalAgentId: string }>;
  logicalAgentIds: string[];
  usedDefault: boolean;
} {
  const sortedActiveAgentIds = [...new Set(activeAgentIds)].sort();
  if (containsRoomMention(text, 'all')) {
    return { mentions: [{ kind: 'all' }], logicalAgentIds: sortedActiveAgentIds, usedDefault: false };
  }
  const mentionedAgentIds = sortedActiveAgentIds.filter(logicalAgentId => containsRoomMention(text, logicalAgentId));
  if (mentionedAgentIds.length > 0) {
    return {
      mentions: mentionedAgentIds.map(logicalAgentId => ({ kind: 'agent' as const, logicalAgentId })),
      logicalAgentIds: mentionedAgentIds,
      usedDefault: false,
    };
  }
  return {
    mentions: [{ kind: 'agent', logicalAgentId: XIAOK_WORKER_SEED_ID }],
    logicalAgentIds: [XIAOK_WORKER_SEED_ID],
    usedDefault: true,
  };
}

function sanitizeRoomAttachmentPaths(value: unknown): Array<{ filePath: string; name: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const attachments: Array<{ filePath: string; name: string }> = [];
  for (const candidate of value) {
    if (!isNonEmptyString(candidate) || candidate.length > MAX_ROOM_ATTACHMENT_PATH_LENGTH || seen.has(candidate)) continue;
    seen.add(candidate);
    attachments.push({ filePath: candidate, name: basename(candidate) || candidate });
    if (attachments.length >= MAX_ROOM_ATTACHMENTS) break;
  }
  return attachments;
}

export function createCollaborationRoomService({
  brokerClient,
  kswarmClient,
  sagaJournal,
  wakeDispatcher,
  emitRoomEvent,
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
  emitRoomEvent?: (event: CollaborationRoomDispatchEvent) => void;
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
    const canonicalMemberAgentIds = [...new Set(
      memberAgentIds.filter(isNonEmptyString).concat(XIAOK_WORKER_SEED_ID),
    )];
    return callBroker('createRoom', {
      title,
      memberAgentIds: canonicalMemberAgentIds,
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
    const addAgentIds = Array.isArray(input.addAgentIds)
      ? [...new Set(input.addAgentIds.filter(isNonEmptyString))]
      : [];
    const removeAgentIds = Array.isArray(input.removeAgentIds)
      ? [...new Set(input.removeAgentIds.filter(isNonEmptyString))]
        .filter((agentId) => agentId !== XIAOK_WORKER_SEED_ID)
      : [];
    return callBroker('updateRoomMembers', {
      roomId: input.roomId,
      expectedRoomRevision: input.expectedRoomRevision,
      addAgentIds,
      removeAgentIds,
    });
  }

  async function sendMessage(input: Record<string, unknown>) {
    if (!isNonEmptyString(input.roomId) || !isNonEmptyString(input.text)) {
      return { ok: false, code: 'room_input_invalid' };
    }
    let snapshot: unknown;
    try {
      snapshot = await brokerClient.getRoomSnapshot(input.roomId);
    } catch {
      return { ok: false, code: 'broker_unavailable' };
    }
    if (!snapshot || typeof snapshot !== 'object' || (snapshot as { ok?: unknown }).ok === false) {
      return { ok: false, code: (snapshot as { code?: unknown })?.code ?? 'room_not_found' };
    }
    let activeAgentIds = activeAgentIdsFromSnapshot(snapshot);
    let route = canonicalRoomRoute(input.text.trim(), activeAgentIds);
    if (route.usedDefault && !activeAgentIds.includes(XIAOK_WORKER_SEED_ID)) {
      const room = (snapshot as { room?: { revision?: unknown } }).room;
      const backfill = await callBroker('updateRoomMembers', {
        roomId: input.roomId,
        expectedRoomRevision: typeof room?.revision === 'number' ? room.revision : undefined,
        addAgentIds: [XIAOK_WORKER_SEED_ID],
        removeAgentIds: [],
      });
      if (!backfill || backfill.ok === false) {
        return { ok: false, code: 'room_default_agent_unavailable', cause: backfill?.code };
      }
      activeAgentIds = [...activeAgentIds, XIAOK_WORKER_SEED_ID];
      route = canonicalRoomRoute(input.text.trim(), activeAgentIds);
    }
    const attachments = sanitizeRoomAttachmentPaths(input.filePaths);
    const result = await callBroker('sendRoomMessage', {
      roomId: input.roomId,
      text: input.text.trim(),
      mentions: route.mentions,
      responsePolicy: 'mentioned',
      ...(isNonEmptyString(input.idempotencyKey) ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(isNonEmptyString(input.replyToMessageId) ? { replyToMessageId: input.replyToMessageId } : {}),
      ...(input.contextScope && typeof input.contextScope === 'object' ? { contextScope: input.contextScope } : {}),
      ...(attachments.length > 0 ? {
        sourceRef: { kind: 'user_attachments', attachments },
      } : {}),
    }) as Record<string, unknown>;
    if (!wakeDispatcher || result?.ok === false || !result?.message || typeof result.message !== 'object') {
      return result;
    }
    const message = result.message as Record<string, unknown>;
    const logicalAgentIds = route.logicalAgentIds;
    const roomMessageId = String(message.messageId);
    const dispatchInput = {
      roomId: input.roomId,
      roomMessageId,
      logicalAgentIds,
    };
    setImmediate(() => {
      void wakeDispatcher.dispatchMessage(dispatchInput).catch(() => {
        emitRoomEvent?.({
          type: 'discussion_settled',
          roomId: input.roomId as string,
          roomMessageId,
          completed: [],
          failed: logicalAgentIds,
        });
      });
    });
    return {
      ...result,
      wake: {
        status: 'queued',
        roomMessageId,
        logicalAgentIds,
      },
    };
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

    const response = await kswarmClient.request(`/projects/${input.projectId}/tasks/human`, {
      method: 'POST',
      body: JSON.stringify({
        tasks: [{
          title: input.title,
          brief: input.brief,
          sourceRoomId: roomId,
          sourceMessageId: input.messageId,
        }],
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
