import { parseMigrationMarker } from '../verification/migration-markers.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { loopHostSubjectOwner } from '../verification/loop-host-subject.js';
import { captureLoopProducerValue } from './producer-value.js';
import { freezeLoopPublicationValue } from './publication-config.js';
const LOOP_PUBLICATION_EDGES = Object.freeze({
    preparing: ['preparing', 'prepared', 'pending', 'not_prepared', 'not_approved', 'committed', 'cancelled'], prepared: ['authorizing', 'pending', 'not_approved', 'committed', 'cancelled'],
    authorizing: ['pending', 'not_approved', 'committed', 'cancelled'], pending: ['pending', 'committed', 'cancelled'], not_prepared: [], not_approved: [], committed: [], cancelled: [],
});
export function loopPublicationTerminal(row) { return LOOP_PUBLICATION_EDGES[row.status].length === 0; }
export function publicationFields(raw, expected) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== [...expected].sort().join(','))
        throw Error('loop_publication_attempt_shape');
}
export function publicationIdentity(v) { if (typeof v !== 'string' || !v || Buffer.byteLength(v) > 160 || /[\x00-\x1f\x7f]/.test(v))
    throw Error('loop_publication_attempt_identity'); }
function hash(v) { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
    throw Error('loop_publication_attempt_hash'); }
function challenge(raw, target) {
    publicationFields(raw, ['challengeId', 'owner', 'fullTupleHash', 'deadline']);
    publicationIdentity(raw.challengeId);
    hash(raw.fullTupleHash);
    publicationFields(raw.owner, ['profileId', 'ownerKind', 'ownerId']);
    publicationIdentity(raw.owner.profileId);
    const owner = loopHostSubjectOwner(target.binding.subject);
    if (raw.owner.ownerKind !== owner.ownerKind || raw.owner.ownerId !== owner.ownerId)
        throw Error('loop_publication_attempt_owner');
    const d = raw.deadline;
    publicationFields(d, ['domainId', 'qualificationEpoch', 'notBefore', 'validUntil']);
    publicationIdentity(d.domainId);
    if (![d.qualificationEpoch, d.notBefore, d.validUntil].every(Number.isSafeInteger) || d.qualificationEpoch < 0 || d.notBefore < 0 || d.validUntil <= d.notBefore || d.validUntil - d.notBefore > 300000)
        throw Error('loop_publication_attempt_deadline');
}
/** Data validation only. Actual journal updates additionally require the
 * workflow's private one-attempt token at the real Store transaction boundary. */
export function parseLoopPublicationAttempt(raw, target) {
    const v = captureLoopProducerValue(raw);
    publicationFields(v, ['attemptId', 'nativeAttemptId', 'candidateId', 'bindingHash', 'sourceVectorHash', 'requestSource', 'routeJson', 'sequence', 'revision', 'status', 'challenge', 'observation', 'retirement', 'createdAt', 'updatedAt']);
    [v.attemptId, v.nativeAttemptId, v.candidateId].forEach(publicationIdentity);
    hash(v.bindingHash);
    hash(v.sourceVectorHash);
    if (v.nativeAttemptId !== target.attempt.attemptId || v.candidateId !== target.attempt.candidateId || v.bindingHash !== target.attempt.bindingHash || v.sourceVectorHash !== target.attempt.sourceVectorHash || v.requestSource !== 'user')
        throw Error('loop_publication_attempt_target');
    if (![v.sequence, v.revision].every(n => Number.isSafeInteger(n) && n >= 1) || v.sequence > 32 || ![v.createdAt, v.updatedAt].every(n => Number.isSafeInteger(n) && n >= target.attempt.createdAt) || v.updatedAt < v.createdAt)
        throw Error('loop_publication_attempt_time');
    if (!Object.hasOwn(LOOP_PUBLICATION_EDGES, v.status))
        throw Error('loop_publication_attempt_status');
    let route = null;
    if (v.routeJson !== null) {
        if (typeof v.routeJson !== 'string' || Buffer.byteLength(v.routeJson) > 65536)
            throw Error('loop_publication_attempt_route');
        route = JSON.parse(v.routeJson);
        publicationFields(route, route?.kind === 'migrated' ? ['kind', 'authorityId', 'owner', 'marker'] : ['kind', 'authorityId', 'owner']);
        if (!['migrated', 'protected-unregistered'].includes(route.kind) || json(route) !== v.routeJson)
            throw Error('loop_publication_attempt_route');
        publicationIdentity(route.authorityId);
        publicationFields(route.owner, ['profileId', 'ownerKind', 'ownerId']);
        publicationIdentity(route.owner.profileId);
        const expected = loopHostSubjectOwner(target.binding.subject);
        if (route.owner.ownerKind !== expected.ownerKind || route.owner.ownerId !== expected.ownerId)
            throw Error('loop_publication_attempt_route');
        if (route.kind === 'migrated') {
            const marker = parseMigrationMarker(route.marker);
            if (marker.state !== 'migrated' || marker.authorityId !== route.authorityId || json({ profileId: marker.profileId, ownerKind: marker.ownerKind, ownerId: marker.ownerId }) !== json(route.owner))
                throw Error('loop_publication_attempt_route');
        }
    }
    if (v.status !== 'preparing' && !route)
        throw Error('loop_publication_attempt_route');
    if (v.challenge !== null) {
        challenge(v.challenge, target);
        if (!route || json(v.challenge.owner) !== json(route.owner))
            throw Error('loop_publication_attempt_owner');
    }
    if (v.observation !== null) {
        publicationFields(v.observation, ['owner', 'status', 'operationId', 'fullTupleHash', 'businessRevision', 'currentVerification']);
        const o = v.observation;
        if (!v.challenge || json(o.owner) !== json(v.challenge.owner) || o.fullTupleHash !== v.challenge.fullTupleHash || !['committed', 'cancelled', 'unknown'].includes(o.status) || !['valid', 'needs_revalidation', 'unavailable'].includes(o.currentVerification) || !Number.isSafeInteger(o.businessRevision) || o.businessRevision < 1)
            throw Error('loop_publication_attempt_observation');
        publicationIdentity(o.operationId);
    }
    if (v.status === 'preparing' && (v.challenge !== null || v.observation !== null || v.retirement !== null))
        throw Error('loop_publication_attempt_facts');
    if (v.status === 'not_prepared') {
        publicationFields(v.retirement, ['status']);
        if (v.retirement.status !== 'not_prepared' || v.challenge !== null || v.observation !== null)
            throw Error('loop_publication_attempt_retirement');
    }
    else if (v.status === 'not_approved') {
        publicationFields(v.retirement, ['status', 'owner', 'challengeId', 'operationId', 'fullTupleHash', 'challenge']);
        const r = v.retirement;
        if (!v.challenge || r.status !== 'not_approved' || v.observation !== null || r.challengeId !== v.challenge.challengeId || json(r.challenge) !== json(v.challenge) || json(r.owner) !== json(v.challenge.owner) || r.fullTupleHash !== v.challenge.fullTupleHash)
            throw Error('loop_publication_attempt_retirement');
        publicationIdentity(r.operationId);
    }
    else if (v.retirement !== null)
        throw Error('loop_publication_attempt_retirement');
    if (!['preparing', 'not_prepared'].includes(v.status) && !v.challenge)
        throw Error('loop_publication_attempt_challenge');
    if (['prepared', 'authorizing'].includes(v.status) && v.observation !== null || v.status === 'pending' && v.observation?.status !== 'unknown' || ['committed', 'cancelled'].includes(v.status) && v.observation?.status !== v.status)
        throw Error('loop_publication_attempt_facts');
    return freezeLoopPublicationValue(v);
}
export function assertLoopPublicationTransition(before, next) {
    if (next.revision !== before.revision + 1 || next.updatedAt < before.updatedAt || !LOOP_PUBLICATION_EDGES[before.status].includes(next.status))
        throw Error('loop_publication_attempt_transition');
    for (const k of ['attemptId', 'nativeAttemptId', 'candidateId', 'bindingHash', 'sourceVectorHash', 'requestSource', 'sequence', 'createdAt'])
        if (json(next[k]) !== json(before[k]))
            throw Error('loop_publication_attempt_identity_changed');
    if (before.routeJson !== null && next.routeJson !== before.routeJson || next.status === 'preparing' && (before.routeJson !== null || next.routeJson === null))
        throw Error('loop_publication_attempt_route_changed');
    if (before.challenge && json(next.challenge) !== json(before.challenge))
        throw Error('loop_publication_attempt_challenge_changed');
    if (before.observation && (!next.observation || ['operationId', 'fullTupleHash', 'businessRevision'].some(k => json(next.observation[k]) !== json(before.observation[k]))))
        throw Error('loop_publication_attempt_operation_changed');
}
