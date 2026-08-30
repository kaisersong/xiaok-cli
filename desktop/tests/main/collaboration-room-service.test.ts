/**
 * CollaborationRoom semantic service (design §9, §12, §16.3).
 *
 * RED until Phase 3 implementation lands.
 *
 * Contract under test — electron/collaboration-room-service.ts:
 *   createCollaborationRoomService({ brokerClient, kswarmClient })
 *     -> { listRooms, getRoom, createRoom, archiveRoom, updateMembers,
 *          sendMessage, markSeen, cancelDiscussion, createProjectFromRoom,
 *          createTaskFromRoomMessage }
 *
 * Invariants:
 *   - renderer inputs are validated semantically; requestSource / actor are
 *     NEVER taken from renderer input — user mutations are pinned to the
 *     local owner identity by main.
 *   - broker / KSwarm unavailability maps to stable degraded codes.
 *   - the composed snapshot takes project truth from KSwarm, never from
 *     room event payloads.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createCollaborationRoomService,
} from '../../electron/collaboration-room-service.js';

function createBrokerFake(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; args: unknown }> = [];
  const record = (method: string) => (input: unknown, ctx?: unknown) => {
    calls.push({ method, args: { input, ctx } });
    return { ok: true };
  };
  return {
    calls,
    createRoom: record('createRoom'),
    archiveRoom: record('archiveRoom'),
    updateRoomMembers: record('updateRoomMembers'),
    sendRoomMessage: record('sendRoomMessage'),
    getRoomSnapshot: vi.fn(async () => ({
      ok: true,
      room: {
        roomId: 'room-1',
        title: 'R',
        status: 'active',
        revision: 4,
      },
      members: [],
      messages: [
        {
          messageId: 'msg-1',
          kind: 'project_event',
          text: 'project created',
          contextScope: { kind: 'project', projectId: 'proj-1' },
          sourceRef: { projectId: 'proj-1' },
        },
      ],
      projects: ['proj-1'],
    })),
    ...overrides,
  };
}

function createKSwarmFake() {
  return {
    request: vi.fn(async (path: string) => {
      if (path === '/projects/proj-1') {
        return {
          ok: true,
          json: async () => ({
            project: {
              id: 'proj-1',
              name: 'Authoritative Name From KSwarm',
              status: 'active',
              primaryRoomId: 'room-1',
            },
          }),
        };
      }
      return { ok: false };
    }),
  };
}

describe('collaboration room semantic service', () => {
  it('rejects invalid createRoom input before touching the broker', async () => {
    const broker = createBrokerFake();
    const service = createCollaborationRoomService({ brokerClient: broker, kswarmClient: createKSwarmFake() });

    const noTitle = await service.createRoom({ title: '   ', memberAgentIds: [] } as never);
    expect(noTitle.ok).toBe(false);
    expect(noTitle.code).toBe('room_input_invalid');

    const badMembers = await service.createRoom({ title: 'x', memberAgentIds: 'not-an-array' } as never);
    expect(badMembers.ok).toBe(false);
  });

  it('pins user mutations to the local owner identity, ignoring renderer-supplied identity', async () => {
    const broker = createBrokerFake();
    const service = createCollaborationRoomService({ brokerClient: broker, kswarmClient: createKSwarmFake() });

    await service.createRoom({
      title: 'Room',
      memberAgentIds: ['agent-a'],
      // spoofed fields from the renderer must be ignored:
      requestSource: 'system',
      actor: { kind: 'user', userId: 'attacker' },
      scopes: ['migration'],
    } as never);

    const createCall = broker.calls.find((c) => c.method === 'createRoom');
    expect(createCall).toBeDefined();
    const ctx = (createCall!.args as { ctx?: { requestSource?: string; actor?: unknown } }).ctx;
    expect(ctx?.requestSource).toBe('user');
    expect((ctx?.actor as { userId?: string })?.userId).not.toBe('attacker');
    expect(ctx?.scopes).toBeUndefined();
  });

  it('maps broker unavailability to the stable broker_unavailable code', async () => {
    const broker = createBrokerFake({
      createRoom: vi.fn(async () => ({ ok: false, code: 'broker_unavailable' })),
    });
    const service = createCollaborationRoomService({ brokerClient: broker, kswarmClient: createKSwarmFake() });

    const result = await service.createRoom({ title: 'Room', memberAgentIds: [] });
    expect(result).toMatchObject({ ok: false, code: 'broker_unavailable' });
  });

  it('composes project truth from KSwarm snapshots, not from room event payloads', async () => {
    const broker = createBrokerFake();
    const kswarm = createKSwarmFake();
    const service = createCollaborationRoomService({ brokerClient: broker, kswarmClient: kswarm });

    const snapshot = await service.getRoom('room-1');
    expect(snapshot.ok).toBe(true);

    const project = (snapshot as { projects: Array<{ id: string; name: string }> }).projects.find(
      (p) => p.id === 'proj-1'
    );
    expect(project?.name).toBe('Authoritative Name From KSwarm');
    expect(kswarm.request).toHaveBeenCalledWith('/projects/proj-1');
  });

  it('createProjectFromRoom validates source messages belong to the room before creating', async () => {
    const broker = createBrokerFake();
    const kswarm = createKSwarmFake();
    const service = createCollaborationRoomService({ brokerClient: broker, kswarmClient: kswarm });

    // msg-404 does not exist in the room snapshot
    const result = await service.createProjectFromRoom({
      roomId: 'room-1',
      name: 'new project',
      goal: 'g',
      poAgentId: 'agent-a',
      sourceMessageIds: ['msg-404'],
    } as never);

    expect(result.ok).toBe(false);
    expect(result.code).toBe('room_message_not_found');
    expect(kswarm.request).not.toHaveBeenCalled();
  });

  it('forwards stable broker error codes through to the renderer', async () => {
    const broker = createBrokerFake({
      archiveRoom: vi.fn(async () => ({ ok: false, code: 'room_revision_conflict' })),
    });
    const service = createCollaborationRoomService({ brokerClient: broker, kswarmClient: createKSwarmFake() });

    const result = await service.archiveRoom({ roomId: 'room-1', expectedRoomRevision: 1 });
    expect(result).toMatchObject({ ok: false, code: 'room_revision_conflict' });
  });

  it('dispatches persisted mention wakes before returning the refreshed room snapshot', async () => {
    const broker = createBrokerFake({
      sendRoomMessage: vi.fn(async () => ({
        ok: true,
        message: {
          messageId: 'msg-user-1',
          roomId: 'room-1',
          responsePolicy: 'mentioned',
          mentions: [{ kind: 'agent', logicalAgentId: 'agent-a' }],
        },
      })),
    });
    const dispatchMessage = vi.fn(async () => ({ ok: true, completed: ['agent-a'] }));
    const service = createCollaborationRoomService({
      brokerClient: broker,
      kswarmClient: createKSwarmFake(),
      wakeDispatcher: { dispatchMessage },
    });

    const result = await service.sendMessage({
      roomId: 'room-1',
      text: '@agent-a inspect this',
      responsePolicy: 'mentioned',
      mentions: [{ kind: 'agent', logicalAgentId: 'agent-a' }],
      idempotencyKey: 'msg-client-1',
    });

    expect(result.ok).toBe(true);
    expect(dispatchMessage).toHaveBeenCalledWith({
      roomId: 'room-1',
      roomMessageId: 'msg-user-1',
      logicalAgentIds: ['agent-a'],
    });
  });
});
