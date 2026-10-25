import { createInstalledVerificationClient } from './controller-client.js';
import { readInstalledCurrentOwner } from './installed-owner-state.js';
import { parseApplicationBindingReview, type ApplicationBindingReview } from './application-binding-review.js';
import { parseIntentApplicationBinding, type IntentApplicationBinding } from './intent-application-binding.js';
import {parseActiveBusinessApplicationBinding, type ActiveIntentApplicationBinding, sameBusinessApplicationSubject} from './business-application-binding.js';
import {intentHostSubjectOwner} from './intent-host-subject.js';
export interface IntentApplicationObservation {readonly state:'unbound'|'pending'|'active';readonly current:Readonly<ActiveIntentApplicationBinding>|null;readonly pendingTransitionId:string|null}
function parseActiveIntentApplicationBinding(raw:unknown):Readonly<ActiveIntentApplicationBinding>{
 const active=parseActiveBusinessApplicationBinding(raw);if(active.binding.kind!=='intent')throw Error('application_client_binding');
 return Object.freeze({binding:active.binding,bindingHash:active.bindingHash,revision:active.revision});
}
import { canonicalVerificationJson as json } from './protocol.js';
export interface IntentApplicationChallenge {
  readonly challengeId: string;
  readonly canonicalReview: Readonly<ApplicationBindingReview>;
  readonly alreadyCommitted: boolean;
}
export interface InstalledIntentApplicationObservation extends IntentApplicationObservation {
  readonly pendingTarget?: Readonly<IntentApplicationBinding> | null;
}
export interface IntentApplicationRequestObservation {
  readonly state: 'absent' | 'not_prepared' | 'not_approved' | 'pending' | 'reauthorization_required' | 'registration_changed' | 'committed';
  readonly challengePhase?: 'prepared' | 'authorizing' | 'approved' | 'committed' | 'failed' | 'retired' | 'not_approved';
  readonly challenge?: Readonly<IntentApplicationChallenge>;
  readonly observation?: Readonly<InstalledIntentApplicationObservation>;
}
function requestId(value: string): void {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value)) throw Error('application_client_request_id');
}
function shape(raw: unknown, expected: string[]) {
  const value = JSON.parse(json(raw));
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== expected.sort().join(',')) throw Error('application_client_shape');
  return value;
}
/** Fixed machine endpoint and current OS owner. Restart records allow only
 * reconciliation; only the original prepared object can initiate native review. */
export function createInstalledIntentApplicationClient(raw: Readonly<IntentApplicationBinding>, requestSource: 'user' | 'agent' | 'scheduler') {
  if (!['user','agent','scheduler'].includes(requestSource)) throw Error('application_client_source');
  const binding = parseIntentApplicationBinding(raw), requested = intentHostSubjectOwner(binding.subject);
  const route = readInstalledCurrentOwner(requested);
  if (route.kind !== 'migrated' && route.kind !== 'protected-unregistered') throw Error('application_client_owner_unavailable');
  const { owner, authorityId } = route;
  const original = json(route), client = createInstalledVerificationClient(), tickets = new WeakSet<object>();
  let closed = false;
  function current() { if (closed || json(readInstalledCurrentOwner(requested)) !== original) throw Error('application_client_owner_changed'); }
  function user() { if (requestSource !== 'user') throw Error('application_client_source'); }
  function challenge(raw: unknown): Readonly<IntentApplicationChallenge> {
    const value = shape(raw, ['challengeId','canonicalReview','alreadyCommitted']);
    const review = parseApplicationBindingReview(value.canonicalReview);
    if (typeof value.alreadyCommitted !== 'boolean' || value.challengeId !== review.challengeId || review.authorityId !== authorityId
      || json(review.owner) !== json(owner) || json(review.binding) !== json(binding)) throw Error('application_client_binding');
    return Object.freeze({ challengeId: review.challengeId, canonicalReview: review, alreadyCommitted: value.alreadyCommitted });
  }
  function observation(raw: unknown, inspect: boolean): Readonly<InstalledIntentApplicationObservation> {
    const value = shape(raw, ['state','current','pendingTransitionId',...(inspect ? ['pendingTarget'] : [])]);
    if (!['active','pending','unbound'].includes(value.state)) throw Error('application_client_state');
    const active = value.current === null ? null : parseActiveIntentApplicationBinding(value.current);
    if (active && (!sameBusinessApplicationSubject(active.binding, binding)||active.binding.contractHash!==binding.contractHash||json(active.binding.contract)!==json(binding.contract))) throw Error('application_client_binding');
    if (value.state === 'pending') {
      if (typeof value.pendingTransitionId !== 'string' || !value.pendingTransitionId || Buffer.byteLength(value.pendingTransitionId) > 160 || /[\x00-\x1f\x7f]/.test(value.pendingTransitionId)) throw Error('application_client_pending');
    } else if (value.pendingTransitionId !== null || (value.state === 'active') !== (active !== null)) throw Error('application_client_state');
    const pendingTarget = inspect && value.pendingTarget !== null ? parseIntentApplicationBinding(value.pendingTarget) : null;
    if (inspect && ((value.state === 'pending') !== (pendingTarget !== null)
      || pendingTarget && (!sameBusinessApplicationSubject(pendingTarget, binding)||pendingTarget.contractHash!==binding.contractHash||json(pendingTarget.contract)!==json(binding.contract)))) throw Error('application_client_pending');
    return Object.freeze({ state: value.state, current: active, pendingTransitionId: value.pendingTransitionId,
      ...(inspect ? { pendingTarget } : {}) });
  }
  function requestObservation(raw: unknown): Readonly<IntentApplicationRequestObservation> {
    const copied = JSON.parse(json(raw));
    if (copied?.state === 'absent' || copied?.state === 'not_prepared') return Object.freeze(shape(copied, ['state'])) as Readonly<IntentApplicationRequestObservation>;
    const value = shape(copied, ['state', 'challengePhase', 'challenge', ...(copied?.state === 'not_approved' ? [] : ['observation'])]);
    const original = challenge(value.challenge), phase = value.challengePhase;
    const allowed: Record<string, readonly string[]> = {
      pending: ['prepared', 'authorizing', 'approved'], not_approved: ['failed', 'retired', 'not_approved'],
      reauthorization_required: ['approved'], registration_changed: ['approved'], committed: ['committed'],
    };
    if (!Object.hasOwn(allowed, value.state) || !allowed[value.state]!.includes(phase)
      || original.alreadyCommitted !== (phase === 'committed')) throw Error('application_client_request_state');
    return Object.freeze({ state: value.state, challengePhase: phase, challenge: original,
      ...(value.state === 'not_approved' ? {} : { observation: observation(value.observation, true) }) });
  }
  return Object.freeze({
    async prepareRequest(id: string, signal?: AbortSignal) {
      user(); requestId(id); signal?.throwIfAborted(); current();
      const raw = await client.applicationTransport.call('application.prepareRequest', { requestSource, requestId: id, binding }, signal);
      signal?.throwIfAborted(); current(); const value = shape(raw, ['created', 'challenge']);
      if (typeof value.created !== 'boolean') throw Error('application_client_request_state');
      const original = challenge(value.challenge);
      if (value.created && !original.alreadyCommitted) tickets.add(original);
      return Object.freeze({ created: value.created as boolean, challenge: original });
    },
    async lookupRequest(id: string, signal?: AbortSignal) {
      requestId(id); signal?.throwIfAborted(); current();
      const raw = await client.applicationTransport.call('application.lookupRequest', { requestSource, requestId: id, binding }, signal);
      signal?.throwIfAborted(); current(); return requestObservation(raw);
    },
    async recoverRequest(id: string, signal?: AbortSignal) {
      requestId(id); signal?.throwIfAborted(); current();
      const raw = await client.applicationTransport.call('application.recoverRequest', { requestSource, requestId: id, binding }, signal);
      signal?.throwIfAborted(); current(); const result = requestObservation(raw);
      if (result.state === 'absent' || result.state === 'pending' && result.challengePhase !== 'approved') throw Error('application_client_request_state');
      return result;
    },
    async inspect(signal?: AbortSignal) {
      current(); const raw = await client.applicationTransport.call('application.inspect', requested, signal);
      signal?.throwIfAborted(); current(); return observation(raw, true);
    },
    async prepare(signal?: AbortSignal) {
      user(); current(); const raw = await client.applicationTransport.call('application.prepare', { requestSource, binding }, signal);
      signal?.throwIfAborted(); current(); const result = challenge(raw);
      if (!result.alreadyCommitted) tickets.add(result);
      return result;
    },
    async authorize(record: Readonly<IntentApplicationChallenge>, signal?: AbortSignal) {
      user(); if (!tickets.has(record)) throw Error('application_client_challenge'); tickets.delete(record);
      current(); const original = challenge(record);
      const raw = await client.applicationTransport.call('application.authorize', { requestSource, challengeId: original.challengeId }, signal);
      signal?.throwIfAborted(); current(); return observation(raw, false);
    },
    async reconcile(record: Readonly<IntentApplicationChallenge>, signal?: AbortSignal) {
      current(); const original = challenge(record);
      const raw = await client.applicationTransport.call('application.reconcile', { requestSource, challengeId: original.challengeId }, signal);
      signal?.throwIfAborted(); current(); return observation(raw, false);
    },
    dispose() { if (!closed) { closed = true; client.dispose(); } },
  });
}
