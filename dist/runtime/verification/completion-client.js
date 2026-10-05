import { isKSwarmOwnerIdentity } from './kswarm-host-subject.js';
import { captureKSwarmEnrollmentData } from './kswarm-enrollment-data.js';
import { parseIntentHostSubject } from './intent-host-subject.js';
import { assertIntentEnrollmentEnvelope, captureIntentRegistrationData, parseIntentRegistrationObservation, parseIntentContractRegistrationObservation } from './intent-contract-enrollment.js';
import { parseOwnerEnrollmentReview, parseGoalForkSourceSnapshot } from './owner-enrollment-review.js';
import { canonicalVerificationJson, hashVerificationTuple, parseVerificationTuple } from './protocol.js';
function freeze(input) {
    const text = canonicalVerificationJson(input);
    if (Buffer.byteLength(text) > 1024 ** 2)
        throw Error('completion_payload_limit');
    const result = JSON.parse(text);
    const visit = (x) => { if (x && typeof x === 'object') {
        Object.values(x).forEach(visit);
        Object.freeze(x);
    } };
    visit(result);
    return result;
}
function shape(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
        throw Error('completion_response_shape');
}
function safeInteger(x) { return Number.isSafeInteger(x) && x >= 0; }
function validateOwner(owner) {
    shape(owner, ['profileId', 'ownerKind', 'ownerId']);
    if (!(['task', 'intent', 'goal', 'loop', 'project'].includes(owner.ownerKind) || isKSwarmOwnerIdentity(owner)) || [owner.profileId, owner.ownerId].some(x => typeof x !== 'string' || !x.length || Buffer.byteLength(x) > 160 || /[\x00-\x1f\x7f]/.test(x)))
        throw Error('completion_owner');
}
function privateHandle(input) {
    const result = freeze(input);
    shape(result, ['id', 'secret']);
    if (typeof result.id !== 'string' || !result.id || result.id.length > 160 || typeof result.secret !== 'string' || result.secret.length < 32 || result.secret.length > 4096)
        throw Error('completion_scope_handle');
    return result;
}
/** Pure historical response validation only; it issues no read grant or currentness fact. */
export function parseCurrentCompletionState(raw, expectedOwner) {
    const owner = freeze(expectedOwner);
    validateOwner(owner);
    const state = freeze(raw);
    shape(state, ['owner', 'migrationEpoch', 'businessRevision', 'obligationSetRevision', 'obligationSetHash', 'obligationCount', 'currentVerification']);
    if (canonicalVerificationJson(state.owner) !== canonicalVerificationJson(owner))
        throw Error('completion_owner_binding');
    if (![state.migrationEpoch, state.businessRevision, state.obligationSetRevision, state.obligationCount].every(safeInteger) || state.obligationCount < 1 || state.obligationCount > 256 || !/^[a-f0-9]{64}$/.test(state.obligationSetHash) || !['valid', 'needs_revalidation', 'unavailable'].includes(state.currentVerification))
        throw Error('completion_response_shape');
    return state;
}
/** Host-bound client for an already protected owner. Reads are fresh observations,
 * never capabilities authorizing a later local success write. The installed signed
 * transport, controller read ACL, migration fencing and receiver remain separate required boundaries.
 */
export function createCompletionClient(input) {
    const owner = freeze(input.owner);
    validateOwner(owner);
    const readGrant = privateHandle(input.readGrant), call = input.transport.call.bind(input.transport), callSync = input.transport.callSync.bind(input.transport);
    const query = Object.freeze({ owner, readGrant });
    const parseState = (raw) => parseCurrentCompletionState(raw, owner);
    function exactTuple(raw) { const tuple = parseVerificationTuple(raw); if (canonicalVerificationJson({ profileId: tuple.profileId, ownerKind: tuple.ownerKind, ownerId: tuple.ownerId }) !== canonicalVerificationJson(owner))
        throw Error('completion_owner_binding'); return tuple; }
    function mutation(tuple, authorization, requestSource) {
        if (!['user', 'agent', 'scheduler'].includes(requestSource))
            throw Error('completion_request_source');
        return Object.freeze({ owner, tuple, authorization: privateHandle(authorization), requestSource });
    }
    return Object.freeze({
        async inspect(signal) { return parseState(await call('completion.inspect', query, signal)); },
        inspectSync() { return parseState(callSync('completion.inspect', query)); },
        async settle(raw, options) {
            const tuple = exactTuple(raw), result = freeze(await call('completion.settle', mutation(tuple, options.authorization, options.requestSource), options.signal));
            shape(result, ['owner', 'operationId', 'fullTupleHash', 'committedBusinessRevision', 'state']);
            if (canonicalVerificationJson(result.owner) !== canonicalVerificationJson(owner) || result.operationId !== tuple.operationId || result.fullTupleHash !== hashVerificationTuple(tuple) || result.committedBusinessRevision !== tuple.expectedBusinessRevision + 1 || result.state !== 'committed')
                throw Error('completion_settlement_binding');
            return result;
        },
        async authorizePublication(raw, options) {
            const tuple = exactTuple(raw), result = freeze(await call('completion.authorize', mutation(tuple, options.authorization, options.requestSource), options.signal));
            shape(result, ['operationId', 'fullTupleHash', 'reservation']);
            if (result.operationId !== tuple.operationId || result.fullTupleHash !== hashVerificationTuple(tuple) || result.reservation !== 'commit_authorized')
                throw Error('completion_reservation_binding');
        },
    });
}
/** Native enrollment is explicit and separate from successful completion. This
 * client only binds the signed reply; the installed daemon owns all grants. */
export function createOwnerEnrollmentClient(transport) {
    const call = transport.call.bind(transport), prepared = new WeakMap();
    function request(raw) { raw = captureKSwarmEnrollmentData(raw, true); assertIntentEnrollmentEnvelope(raw); const value = freeze(raw); shape(value, ['requestId', 'enrollment', 'registration']); if (typeof value.requestId !== 'string' || !value.requestId || Buffer.byteLength(value.requestId) > 160 || /[\x00-\x1f\x7f]/.test(value.requestId))
        throw Error('enrollment_client_request'); return value; }
    function requestChallenge(raw, input) {
        const value = freeze(raw);
        shape(value, ['challengeId', 'canonicalReview']);
        const review = parseOwnerEnrollmentReview(value.canonicalReview);
        if (value.challengeId !== review.challengeId || canonicalVerificationJson({ enrollment: review.enrollment, registration: review.registration }) !== canonicalVerificationJson({ enrollment: input.enrollment, registration: input.registration }))
            throw Error('enrollment_client_binding');
        return Object.freeze({ challengeId: review.challengeId, canonicalReview: review });
    }
    function requestObservation(raw, input) {
        const value = freeze(raw);
        if (!value || typeof value !== 'object')
            throw Error('enrollment_client_request');
        const state = value.state;
        if (state === 'absent' || state === 'not_prepared') {
            shape(value, ['state']);
            return Object.freeze({ state });
        }
        if (!['mapped', 'not_approved', 'committed'].includes(state))
            throw Error('enrollment_client_request');
        shape(value, state === 'committed' ? ['state', 'challenge', 'owner'] : ['state', 'challenge']);
        const challenge = requestChallenge(value.challenge, input);
        if (state === 'committed') {
            validateOwner(value.owner);
            if (value.owner.ownerKind !== input.enrollment.ownerKind || value.owner.ownerId !== input.enrollment.ownerId)
                throw Error('enrollment_client_binding');
            return Object.freeze({ state, challenge, owner: value.owner });
        }
        return Object.freeze({ state, challenge });
    }
    return Object.freeze({
        async readIntentRegistration(raw, signal) {
            const value = captureIntentRegistrationData(raw);
            shape(value, ['subject']);
            const subject = parseIntentHostSubject(value.subject);
            signal?.throwIfAborted();
            const result = parseIntentRegistrationObservation(await call('completion.read-intent-registration', { subject }, signal));
            signal?.throwIfAborted();
            if (canonicalVerificationJson(result.subject) !== canonicalVerificationJson(subject))
                throw Error('enrollment_intent_binding');
            return result;
        },
        async readIntentContract(raw, signal) {
            const value = captureIntentRegistrationData(raw);
            shape(value, ['subject']);
            const subject = parseIntentHostSubject(value.subject);
            signal?.throwIfAborted();
            const result = parseIntentContractRegistrationObservation(await call('completion.read-intent-contract', { subject }, signal));
            signal?.throwIfAborted();
            if (canonicalVerificationJson(result.subject) !== canonicalVerificationJson(subject))
                throw Error('enrollment_intent_binding');
            return result;
        },
        async readGoalForkSource(raw, signal) {
            const query = freeze(raw);
            shape(query, ['ownerKind', 'ownerId', 'sessionId']);
            validateOwner({ profileId: 'pending-resolution', ownerKind: query.ownerKind, ownerId: query.ownerId });
            if (query.ownerKind !== 'goal' || typeof query.sessionId !== 'string' || !query.sessionId || Buffer.byteLength(query.sessionId) > 160 || /[\x00-\x1f\x7f]/.test(query.sessionId))
                throw Error('enrollment_fork_session');
            signal?.throwIfAborted();
            const result = parseGoalForkSourceSnapshot(await call('completion.read-goal-fork-source', query, signal));
            signal?.throwIfAborted();
            if (result.source.owner.ownerId !== query.ownerId || result.source.sessionId !== query.sessionId)
                throw Error('enrollment_fork_binding');
            return result;
        },
        async prepareRequest(raw, signal) {
            const input = request(raw), result = freeze(await call('completion.prepare-owner-request', input, signal));
            shape(result, ['created', 'challenge']);
            if (typeof result.created !== 'boolean')
                throw Error('enrollment_client_request');
            const challenge = requestChallenge(result.challenge, input);
            if (result.created)
                prepared.set(challenge, challenge.canonicalReview);
            return Object.freeze({ created: result.created, challenge });
        },
        async lookupRequest(raw, signal) { const input = request(raw); return requestObservation(await call('completion.lookup-owner-request', input, signal), input); },
        async recoverRequest(raw, signal) { const input = request(raw), result = requestObservation(await call('completion.recover-owner-request', input, signal), input); if (result.state === 'absent' || result.state === 'mapped')
            throw Error('enrollment_client_recovery'); return result; },
        async prepare(raw, signal) {
            raw = captureKSwarmEnrollmentData(raw, true);
            assertIntentEnrollmentEnvelope(raw);
            const request = freeze(raw);
            shape(request, ['enrollment', 'registration']);
            const result = freeze(await call('completion.prepare-owner', request, signal));
            shape(result, ['challengeId', 'canonicalReview']);
            const review = parseOwnerEnrollmentReview(result.canonicalReview);
            if (result.challengeId !== review.challengeId || canonicalVerificationJson({ enrollment: review.enrollment, registration: review.registration }) !== canonicalVerificationJson(request))
                throw Error('enrollment_client_binding');
            const ticket = Object.freeze({ challengeId: review.challengeId, canonicalReview: review });
            prepared.set(ticket, review);
            return ticket;
        },
        async authorize(ticket, signal) {
            const review = prepared.get(ticket);
            if (!review)
                throw Error('enrollment_client_challenge');
            prepared.delete(ticket);
            const result = freeze(await call('completion.authorize-owner', { challengeId: review.challengeId }, signal));
            shape(result, ['owner', 'readGrant']);
            validateOwner(result.owner);
            if (result.owner.ownerKind !== review.enrollment.ownerKind || result.owner.ownerId !== review.enrollment.ownerId)
                throw Error('enrollment_client_binding');
            return Object.freeze({ owner: result.owner, readGrant: privateHandle(result.readGrant) });
        },
    });
}
export async function openCompletionClient(input) {
    const request = freeze({ ownerKind: input.ownerKind, ownerId: input.ownerId });
    validateOwner({ profileId: 'pending-resolution', ...request });
    const response = freeze(await input.transport.call('completion.open-owner', request, input.signal));
    shape(response, ['owner', 'readGrant']);
    validateOwner(response.owner);
    if (response.owner.ownerKind !== request.ownerKind || response.owner.ownerId !== request.ownerId)
        throw Error('completion_owner_binding');
    return createCompletionClient({ owner: response.owner, readGrant: privateHandle(response.readGrant), transport: input.transport });
}
export function openCompletionClientSync(input) {
    const request = freeze({ ownerKind: input.ownerKind, ownerId: input.ownerId });
    validateOwner({ profileId: 'pending-resolution', ...request });
    const response = freeze(input.transport.callSync('completion.open-owner', request));
    shape(response, ['owner', 'readGrant']);
    validateOwner(response.owner);
    if (response.owner.ownerKind !== request.ownerKind || response.owner.ownerId !== request.ownerId)
        throw Error('completion_owner_binding');
    return createCompletionClient({ owner: response.owner, readGrant: privateHandle(response.readGrant), transport: input.transport });
}
