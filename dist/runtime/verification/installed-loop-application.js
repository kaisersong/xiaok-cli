import { createInstalledVerificationClient } from './controller-client.js';
import { readInstalledCurrentOwner } from './installed-owner-state.js';
import { parseApplicationBindingReview } from './application-binding-review.js';
import { parseLoopApplicationBinding } from './loop-application-binding.js';
import { parseActiveBusinessApplicationBinding, sameBusinessApplicationSubject } from './business-application-binding.js';
import { loopHostSubjectOwner } from './loop-host-subject.js';
function parseActiveLoopApplicationBinding(raw) {
    const active = parseActiveBusinessApplicationBinding(raw);
    if (active.binding.kind !== 'loop')
        throw Error('application_client_binding');
    return Object.freeze({ binding: active.binding, bindingHash: active.bindingHash, revision: active.revision });
}
import { canonicalVerificationJson as json } from './protocol.js';
function requestId(value) {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
        throw Error('application_client_request_id');
}
function shape(raw, expected) {
    const value = JSON.parse(json(raw));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== expected.sort().join(','))
        throw Error('application_client_shape');
    return value;
}
/** Fixed machine endpoint and current OS owner. Restart records allow only
 * reconciliation; only the original prepared object can initiate native review. */
export function createInstalledLoopApplicationClient(raw, requestSource) {
    if (!['user', 'agent', 'scheduler'].includes(requestSource))
        throw Error('application_client_source');
    const binding = parseLoopApplicationBinding(raw), requested = loopHostSubjectOwner(binding.subject);
    const route = readInstalledCurrentOwner(requested);
    if (route.kind !== 'migrated' && route.kind !== 'protected-unregistered')
        throw Error('application_client_owner_unavailable');
    const { owner, authorityId } = route;
    const original = json(route), client = createInstalledVerificationClient(), tickets = new WeakSet();
    let closed = false;
    function current() { if (closed || json(readInstalledCurrentOwner(requested)) !== original)
        throw Error('application_client_owner_changed'); }
    function user() { if (requestSource !== 'user')
        throw Error('application_client_source'); }
    function challenge(raw) {
        const value = shape(raw, ['challengeId', 'canonicalReview', 'alreadyCommitted']);
        const review = parseApplicationBindingReview(value.canonicalReview);
        if (typeof value.alreadyCommitted !== 'boolean' || value.challengeId !== review.challengeId || review.authorityId !== authorityId
            || json(review.owner) !== json(owner) || json(review.binding) !== json(binding))
            throw Error('application_client_binding');
        return Object.freeze({ challengeId: review.challengeId, canonicalReview: review, alreadyCommitted: value.alreadyCommitted });
    }
    function observation(raw, inspect) {
        const value = shape(raw, ['state', 'current', 'pendingTransitionId', ...(inspect ? ['pendingTarget'] : [])]);
        if (!['active', 'pending', 'unbound'].includes(value.state))
            throw Error('application_client_state');
        const active = value.current === null ? null : parseActiveLoopApplicationBinding(value.current);
        if (active && !sameBusinessApplicationSubject(active.binding, binding))
            throw Error('application_client_binding');
        if (value.state === 'pending') {
            if (typeof value.pendingTransitionId !== 'string' || !value.pendingTransitionId || Buffer.byteLength(value.pendingTransitionId) > 160 || /[\x00-\x1f\x7f]/.test(value.pendingTransitionId))
                throw Error('application_client_pending');
        }
        else if (value.pendingTransitionId !== null || (value.state === 'active') !== (active !== null))
            throw Error('application_client_state');
        const pendingTarget = inspect && value.pendingTarget !== null ? parseLoopApplicationBinding(value.pendingTarget) : null;
        if (inspect && ((value.state === 'pending') !== (pendingTarget !== null)
            || pendingTarget && !sameBusinessApplicationSubject(pendingTarget, binding)))
            throw Error('application_client_pending');
        return Object.freeze({ state: value.state, current: active, pendingTransitionId: value.pendingTransitionId,
            ...(inspect ? { pendingTarget } : {}) });
    }
    function requestObservation(raw) {
        const copied = JSON.parse(json(raw));
        if (copied?.state === 'absent' || copied?.state === 'not_prepared')
            return Object.freeze(shape(copied, ['state']));
        const value = shape(copied, ['state', 'challengePhase', 'challenge', ...(copied?.state === 'not_approved' ? [] : ['observation'])]);
        const original = challenge(value.challenge), phase = value.challengePhase;
        const allowed = {
            pending: ['prepared', 'authorizing', 'approved'], not_approved: ['failed', 'retired', 'not_approved'],
            reauthorization_required: ['approved'], registration_changed: ['approved'], committed: ['committed'],
        };
        if (!Object.hasOwn(allowed, value.state) || !allowed[value.state].includes(phase)
            || original.alreadyCommitted !== (phase === 'committed'))
            throw Error('application_client_request_state');
        return Object.freeze({ state: value.state, challengePhase: phase, challenge: original,
            ...(value.state === 'not_approved' ? {} : { observation: observation(value.observation, true) }) });
    }
    return Object.freeze({
        async prepareRequest(id, signal) {
            user();
            requestId(id);
            signal?.throwIfAborted();
            current();
            const raw = await client.applicationTransport.call('application.prepareRequest', { requestSource, requestId: id, binding }, signal);
            signal?.throwIfAborted();
            current();
            const value = shape(raw, ['created', 'challenge']);
            if (typeof value.created !== 'boolean')
                throw Error('application_client_request_state');
            const original = challenge(value.challenge);
            if (value.created && !original.alreadyCommitted)
                tickets.add(original);
            return Object.freeze({ created: value.created, challenge: original });
        },
        async lookupRequest(id, signal) {
            requestId(id);
            signal?.throwIfAborted();
            current();
            const raw = await client.applicationTransport.call('application.lookupRequest', { requestSource, requestId: id, binding }, signal);
            signal?.throwIfAborted();
            current();
            return requestObservation(raw);
        },
        async recoverRequest(id, signal) {
            requestId(id);
            signal?.throwIfAborted();
            current();
            const raw = await client.applicationTransport.call('application.recoverRequest', { requestSource, requestId: id, binding }, signal);
            signal?.throwIfAborted();
            current();
            const result = requestObservation(raw);
            if (result.state === 'absent' || result.state === 'pending' && result.challengePhase !== 'approved')
                throw Error('application_client_request_state');
            return result;
        },
        async inspect(signal) {
            current();
            const raw = await client.applicationTransport.call('application.inspect', requested, signal);
            signal?.throwIfAborted();
            current();
            return observation(raw, true);
        },
        async prepare(signal) {
            user();
            current();
            const raw = await client.applicationTransport.call('application.prepare', { requestSource, binding }, signal);
            signal?.throwIfAborted();
            current();
            const result = challenge(raw);
            if (!result.alreadyCommitted)
                tickets.add(result);
            return result;
        },
        async authorize(record, signal) {
            user();
            if (!tickets.has(record))
                throw Error('application_client_challenge');
            tickets.delete(record);
            current();
            const original = challenge(record);
            const raw = await client.applicationTransport.call('application.authorize', { requestSource, challengeId: original.challengeId }, signal);
            signal?.throwIfAborted();
            current();
            return observation(raw, false);
        },
        async reconcile(record, signal) {
            current();
            const original = challenge(record);
            const raw = await client.applicationTransport.call('application.reconcile', { requestSource, challengeId: original.challengeId }, signal);
            signal?.throwIfAborted();
            current();
            return observation(raw, false);
        },
        dispose() { if (!closed) {
            closed = true;
            client.dispose();
        } },
    });
}
