import { randomUUID } from 'node:crypto';
import type { RoomWorkspaceBrokerPort } from './room-workspace-service.js';

/** Private authenticated main transport, never exposed as a generic IPC API. */
export function createRoomWorkspaceBrokerClient(options: {
  token: string; isMutationOwner: () => boolean; fetchImpl?: typeof fetch; baseUrl?: string;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:4318';
  const startupId = randomUUID();
  let registration: Promise<{ hostId: string; hostIncarnation: number }> | undefined;
  async function send(roomId: string, action?: string, input?: Record<string, unknown>, incarnation?: number, revision?: number) {
    const url = `${baseUrl}/rooms/${encodeURIComponent(roomId)}/workspace${action ? `/${action}` : ''}${revision === undefined ? '' : `?instructionsRevision=${revision}`}`;
    const response = await fetchImpl(url, {
      method: action ? 'POST' : 'GET',
      signal: AbortSignal.timeout(15_000),
      headers: { 'x-intent-broker-room-token': options.token, ...(action ? { 'content-type': 'application/json' } : {}), ...(incarnation ? { 'x-intent-broker-host-incarnation': String(incarnation) } : {}) },
      ...(action ? { body: JSON.stringify(input ?? {}) } : {}),
    });
    return await response.json() as Record<string, unknown>;
  }
  async function getHost(roomId: string) {
    if (!options.isMutationOwner()) throw new Error('workspace_mutation_owner_busy');
    if (!registration) registration = send(roomId, 'register-host', { startupId }).then(result => {
      const host = result.host as { hostId?: string; hostIncarnation?: number } | undefined;
      if (!result.ok || !host?.hostId || !Number.isSafeInteger(host.hostIncarnation)) throw new Error(String(result.code ?? 'workspace_protocol_unavailable'));
      return { hostId: host.hostId, hostIncarnation: host.hostIncarnation! };
    }).catch(error => { registration = undefined; throw error; });
    return registration;
  }
  const port: RoomWorkspaceBrokerPort = {
    async get(roomId) { const host = await getHost(roomId); return send(roomId, undefined, undefined, host.hostIncarnation); },
    async request(roomId, action, input) {
      if (!/^[a-z]+(?:-[a-z]+)*$/.test(action)) throw new Error('workspace_action_invalid');
      const host = await getHost(roomId); return send(roomId, action, input, host.hostIncarnation);
    },
  };
  return { ...port, getHost,
    async getInstructions(roomId: string, revision: number) {
      const host = await getHost(roomId); return send(roomId, undefined, undefined, host.hostIncarnation, revision);
    },
    async probe() {
      const response = await fetchImpl(`${baseUrl}/rooms/workspace-protocol`, { headers: { 'x-intent-broker-room-token': options.token }, signal: AbortSignal.timeout(15_000) });
      return response.json();
    },
  };
}
