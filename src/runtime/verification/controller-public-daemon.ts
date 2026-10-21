import {METADATA_CAPACITY_METHODS} from './metadata-capacity-protocol.js';
import {APPLICATION_METHODS} from './application-transport.js';
import {ARCHIVE_METHODS} from './archive-transport.js';
import { createHash, type KeyObject } from 'node:crypto';
import type { Socket } from 'node:net';
import { canonicalVerificationJson } from './protocol.js';
import { startControllerIpc } from './controller-ipc.js';
import { COMPLETION_METHODS } from './completion-transport.js';
import { encodeControllerResponse } from './controller-response.js';
import { createControllerRequestTickets } from './controller-request-tickets.js';

const methods = ['controller.identity', 'maintenance.diagnose', 'controller.qualification', 'materials.prepareRequest', 'materials.lookupRequest', 'materials.retireRequest', 'materials.prepare', 'materials.authorize', 'materials.stage', 'execution.reserve', 'execution.dispatch', 'execution.quiescence', 'verification.inspectObligation', 'verification.prepareRequest', 'verification.lookupRequest', 'verification.retireRequest', 'verification.recoverRequest', 'verification.prepare', 'verification.dispatch', 'publication.prepareRequest', 'publication.lookupRequest', 'publication.recoverRequest', 'publication.recoverUnapproved', 'publication.prepare', 'publication.approve', 'publication.reconcile', 'publication.recoverExpired', 'publication.observeIntentCompletion','publication.observeIntentDependencies', 'publication.observeLoopSet', 'publication.observeOwner', 'publication.readOwnerPayload', ...COMPLETION_METHODS, ...ARCHIVE_METHODS, ...APPLICATION_METHODS, ...METADATA_CAPACITY_METHODS] as const;
export type PublicControllerMethod = typeof methods[number];
export interface ControllerPeer { readonly uid: number; readonly gid: number; readonly auditSessionId: number }
/** Service-private composition. Installed entry supplies kernel peer reader and qualified
 * authority handlers; this transport never treats a caller DTO or fixture callback as qualification. */
export async function startPublicController(options: {
  socketPath: string; authorityId: string; serviceEpoch: string; privateKey: KeyObject;
  allowedUserIds: readonly number[];
  acceptPeer(socket: Socket): ControllerPeer;
  invoke(method: PublicControllerMethod, payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
}): Promise<{ close(): Promise<void> }> {
  const { authorityId, serviceEpoch, privateKey, acceptPeer, invoke } = options;
  for (const id of [authorityId, serviceEpoch]) if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw Error('controller_identity');
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') throw Error('controller_response_key');
  const allowedUserIds = new Set(options.allowedUserIds);
  if (!allowedUserIds.size || [...allowedUserIds].some(uid => !Number.isSafeInteger(uid) || uid < 0)) throw Error('controller_peer_allowlist');
  const tickets = createControllerRequestTickets();
  return startControllerIpc({ socketPath: options.socketPath, requestTimeoutMs: 300000, publicPeerAuthenticated: true,
    acceptPeer(socket) {
      const peer = acceptPeer(socket);
      if (!peer || Object.keys(peer).sort().join(',') !== 'auditSessionId,gid,uid' || !Number.isSafeInteger(peer.uid) || peer.uid < 0 || !Number.isSafeInteger(peer.gid) || peer.gid < 0 || !Number.isSafeInteger(peer.auditSessionId) || peer.auditSessionId < 1 || !allowedUserIds.has(peer.uid)) {
        if (peer && typeof (peer as unknown as { then?: unknown }).then === 'function') void Promise.resolve(peer).catch(() => {});
        throw Error('controller_peer_unknown');
      }
      return Object.freeze({ uid: peer.uid, gid: peer.gid, auditSessionId: peer.auditSessionId });
    },
    async dispatch(bytes, signal, connectionPeer) {
      const request = JSON.parse(bytes.toString('utf8'));
      if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).sort().join(',') !== 'authorityId,domain,method,nonce,payload,requestHash,requestTicket,serviceEpoch,version' || request.version !== 1 || request.domain !== 'xiaok.controller.request.v1' || request.authorityId !== authorityId || typeof request.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(request.nonce) || !methods.includes(request.method) || request.requestHash !== createHash('sha256').update(canonicalVerificationJson(request.payload)).digest('hex') || !Buffer.from(canonicalVerificationJson(request)).equals(bytes)) throw Error('controller_request_schema');
      if (request.method === 'controller.identity' ? request.serviceEpoch !== null || request.requestTicket !== null : request.serviceEpoch !== serviceEpoch) throw Error('controller_request_epoch');
      const peer = connectionPeer as ControllerPeer;
      const principal = `kernel-session:v1:${peer.uid}:${peer.gid}:${peer.auditSessionId}`;
      if (request.method !== 'controller.identity') tickets.consume(request.requestTicket, principal);
      let result: unknown;
      try { signal.throwIfAborted(); result = request.method === 'controller.identity' ? { serviceEpoch, requestTicket: tickets.issue(principal) } : await invoke(request.method, request.payload, connectionPeer as ControllerPeer, signal); }
      catch { result = { error: { code: 'controller_operation_rejected' } }; }
      return encodeControllerResponse({ domain: 'xiaok.controller.response.v1', authorityId, serviceEpoch, nonce: request.nonce, method: request.method, requestHash: request.requestHash, result }, privateKey);
    },
  });
}
