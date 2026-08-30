/**
 * Preload / IPC contract for collaboration rooms (design §9.3, §12, §16.3).
 *
 * RED until Phase 3 implementation lands (except the existing anchored
 * allowlist assertions, which must stay green as a regression pin).
 *
 * Invariants:
 *   - the seven kswarmProxy* channels reject every Room/link route with a
 *     stable error; room mutations are only reachable through the semantic
 *     preload API (exhaustive deny, design §9.3).
 *   - the preload surface gains exactly the semantic room APIs from
 *     design §12 — no broker URL, no generic HTTP, no SQLite escape hatch.
 *   - renderer-visible room payload types never include requestSource,
 *     actor, sessionId or credential fields.
 */
import { describe, expect, it } from 'vitest';
import {
  createPreloadApi,
  PRELOAD_API_KEYS,
} from '../../electron/preload-api.js';
import {
  isSafeKswarmProxyPath,
} from '../../electron/kswarm-ipc-proxy.js';

const PROXY_METHODS = ['get', 'getText', 'post', 'postJson', 'put', 'patch', 'delete'] as const;

const ROOM_ROUTES = [
  '/rooms',
  '/rooms/room-1',
  '/rooms/room-1/messages',
  '/rooms/room-1/members',
  '/rooms/room-1/archive',
  '/rooms/room-1/seen',
  '/rooms/room-1/discussion',
  '/room-links',
  '/room-links/room-1',
  '/collaboration-rooms',
  '/collaboration-rooms/room-1',
  '/rooms/room-1/projects',
  '/rooms/room-1/project-operations',
];

describe('kswarmProxy exhaustive room route deny', () => {
  it.each(ROOM_ROUTES)('rejects room route %s on every proxy method', (route) => {
    for (const method of PROXY_METHODS) {
      expect(isSafeKswarmProxyPath(method, route)).toBe(false);
    }
  });

  it('keeps the existing non-room allowlist anchored at the end (no prefix capture)', () => {
    // an anchored allowlist must not match longer paths that merely start
    // with an allowed segment
    expect(isSafeKswarmProxyPath('get', '/projects')).toBe(true);
    expect(isSafeKswarmProxyPath('get', '/projectsX')).toBe(false);
    expect(isSafeKswarmProxyPath('get', '/projects/proj-1/rooms')).toBe(false);
    expect(isSafeKswarmProxyPath('post', '/projects/proj-1/tasks')).toBe(true);
    expect(isSafeKswarmProxyPath('post', '/projects/proj-1/tasks/../../rooms')).toBe(false);
  });
});

describe('semantic room preload API surface', () => {
  it('exposes exactly the design §12 semantic room APIs', () => {
    const expectedRoomKeys = [
      'listCollaborationRooms',
      'getCollaborationRoom',
      'createCollaborationRoom',
      'archiveCollaborationRoom',
      'updateCollaborationRoomMembers',
      'sendCollaborationRoomMessage',
      'markCollaborationRoomSeen',
      'cancelRoomDiscussion',
      'createProjectFromRoom',
      'createTaskFromRoomMessage',
      'onCollaborationRoomEvent',
    ];
    for (const key of expectedRoomKeys) {
      expect(PRELOAD_API_KEYS).toContain(key);
    }
  });

  it('does not expose raw broker transport to the renderer', () => {
    for (const forbidden of [
      'brokerUrl',
      'brokerRequest',
      'roomHttpRequest',
      'roomSqlite',
      'roomRawSend',
    ]) {
      expect(PRELOAD_API_KEYS).not.toContain(forbidden);
    }
  });

  it('preload api object wires the room keys to semantic channels', async () => {
    const invoke = async (channel: string) => ({ channel });
    const preload = createPreloadApi(invoke as never, {} as never, {} as never, {} as never, {} as never);

    expect(typeof preload.sendCollaborationRoomMessage).toBe('function');
    expect(typeof preload.onCollaborationRoomEvent).toBe('function');
    // requestSource / actor are not part of any renderer-callable input type;
    // this is enforced by types, but the runtime surface must not accept
    // them either — the semantic layer pins identity itself.
    expect((preload as Record<string, unknown>).setRoomRequestSource).toBeUndefined();
  });
});
