import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalVerificationJson } from './protocol.js';
import type { ReceiverResult } from './receiver-store.js';

export type ReceiverReplyResult = ReceiverResult | { status: 'unknown'; fullTupleHash: string };
export interface ReceiverReplyRequest { fullTupleHash: string; challenge: string }
export interface Identity { keyId: string; receiverId: string; receiverInstanceEpoch: number }
export interface SignedReceiverReply {
  payload: Identity & { domain: 'xiaok.p3r.receiver.v1'; fullTupleHash: string; challenge: string; result: ReceiverReplyResult };
  signature: string;
}
export interface AuthenticatedReceiverReply { readonly authenticatedReceiverReply: true }
const replies = new WeakMap<object, { payload: Readonly<SignedReceiverReply['payload']>; authority: object }>();
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function validateRequest(request: ReceiverReplyRequest): void {
  if (!hash(request.fullTupleHash) || !hash(request.challenge) || Object.keys(request).length !== 2) throw Error('receiver_reply_request');
}
function identity(input: Identity): Identity {
  if (!input.keyId || !input.receiverId || input.keyId.length > 160 || input.receiverId.length > 160 || !Number.isSafeInteger(input.receiverInstanceEpoch) || input.receiverInstanceEpoch < 0) throw Error('receiver_reply_identity');
  return Object.freeze({ keyId: input.keyId, receiverId: input.receiverId, receiverInstanceEpoch: input.receiverInstanceEpoch });
}
function validateResult(result: ReceiverReplyResult, expectedHash: string): void {
  if (!result || result.fullTupleHash !== expectedHash || !['prepared', 'committed', 'cancelled', 'unknown'].includes(result.status)) throw Error('receiver_reply_result');
  const allowed = new Set(['status', 'fullTupleHash']);
  if (result.status !== 'unknown') {
    allowed.add('objectRevision');
    if (!Number.isSafeInteger(result.objectRevision) || result.objectRevision < 1) throw Error('receiver_reply_revision');
  }
  if (result.status === 'committed' || result.status === 'cancelled') {
    allowed.add('terminalRecordHash'); if (!hash(result.terminalRecordHash)) throw Error('receiver_reply_terminal_hash');
    if (result.status === 'cancelled') {
      allowed.add('reason'); if (!['user_cancelled', 'expired', 'clock_unavailable'].includes(result.reason!)) throw Error('receiver_reply_cancel_reason');
    }
    if (result.clock !== undefined) {
      allowed.add('clock'); const c = result.clock;
      if (!c || Object.keys(c).length !== 5 || !c.domainId || !Number.isSafeInteger(c.qualificationEpoch) || c.qualificationEpoch < 0 || !Number.isSafeInteger(c.lowerBound) || !Number.isSafeInteger(c.upperBound) || c.lowerBound < 0 || c.upperBound < c.lowerBound || !hash(c.evidenceHash)) throw Error('receiver_reply_clock');
    } else if (result.status === 'committed') throw Error('receiver_reply_clock');
  }
  if (Object.keys(result).some(k => !allowed.has(k))) throw Error('receiver_reply_extra_field');
}
function cloneFrozen<T>(value: T): T {
  const copy = JSON.parse(canonicalVerificationJson(value));
  function freeze(x: unknown): void { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } }
  freeze(copy); return copy;
}
/** Install only inside the independently protected receiver service; never expose this signer to a project worker. */
export function createReceiverReplySigner(options: Identity & { privateKey: KeyObject }) {
  const id = identity(options), key = options.privateKey;
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') throw Error('receiver_reply_key_type');
  return Object.freeze({ sign(request: ReceiverReplyRequest, result: ReceiverReplyResult): SignedReceiverReply {
    validateRequest(request); validateResult(result, request.fullTupleHash);
    const payload = cloneFrozen({ ...id, domain: 'xiaok.p3r.receiver.v1' as const, ...request, result });
    const signature = sign(null, Buffer.from(canonicalVerificationJson(payload)), key).toString('base64');
    return Object.freeze({ payload, signature });
  } });
}
/** Registration is host deployment configuration, not a public requestSource/user claim. */
export function createReceiverReplyVerifier(options: Identity & { publicKey: KeyObject }) {
  const id = identity(options); const key = options.publicKey.type === 'public' ? options.publicKey : createPublicKey(options.publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw Error('receiver_reply_key_type');
  const authority = Object.freeze({}); let revoked = false;
  return Object.freeze({ revoke() { revoked = true; }, read(reply: AuthenticatedReceiverReply) {
    const record = replies.get(reply); if (revoked || !record || record.authority !== authority) throw Error('receiver_reply_wrong_registration'); return record.payload;
  }, verify(envelope: SignedReceiverReply, request: ReceiverReplyRequest): AuthenticatedReceiverReply {
    if (revoked) throw Error('receiver_registration_revoked');
    validateRequest(request);
    if (!envelope || Object.keys(envelope).length !== 2 || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw Error('receiver_reply_signature');
    const payload = envelope.payload;
    if (!payload || Object.keys(payload).length !== 7 || payload.domain !== 'xiaok.p3r.receiver.v1' || payload.keyId !== id.keyId || payload.receiverId !== id.receiverId || payload.receiverInstanceEpoch !== id.receiverInstanceEpoch || payload.fullTupleHash !== request.fullTupleHash || payload.challenge !== request.challenge) throw Error('receiver_reply_binding');
    validateResult(payload.result, request.fullTupleHash);
    const bytes = Buffer.from(canonicalVerificationJson(payload));
    if (bytes.byteLength > 1024 ** 2 || !verify(null, bytes, key, Buffer.from(envelope.signature, 'base64'))) throw Error('receiver_reply_signature');
    const opaque = Object.freeze({ authenticatedReceiverReply: true as const }); replies.set(opaque, { payload: cloneFrozen(payload), authority }); return opaque;
  } });
}
