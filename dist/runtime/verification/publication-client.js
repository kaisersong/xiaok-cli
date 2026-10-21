import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
function snapshot(raw, keys) { const v = JSON.parse(json(raw)); if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.sort().join(','))
    throw Error('publication_client_shape'); return v; }
function id(v) { if (typeof v !== 'string' || !v || Buffer.byteLength(v) > 160 || /[\x00-\x1f\x7f]/.test(v))
    throw Error('publication_client_identity'); }
function owner(raw) { const v = snapshot(raw, ['profileId', 'ownerKind', 'ownerId']); id(v.profileId); id(v.ownerId); if (!['task', 'intent', 'goal', 'loop', 'project'].includes(v.ownerKind))
    throw Error('publication_client_owner'); return Object.freeze(v); }
export function parsePublicationChallenge(raw, boundOwner) { boundOwner = owner(boundOwner); const v = snapshot(raw, ['challengeId', 'owner', 'fullTupleHash', 'deadline']); id(v.challengeId); if (json(owner(v.owner)) !== json(boundOwner) || !/^[a-f0-9]{64}$/.test(v.fullTupleHash))
    throw Error('publication_client_binding'); const d = snapshot(v.deadline, ['domainId', 'qualificationEpoch', 'notBefore', 'validUntil']); id(d.domainId); if (![d.qualificationEpoch, d.notBefore, d.validUntil].every(Number.isSafeInteger) || d.qualificationEpoch < 0 || d.notBefore < 0 || d.validUntil <= d.notBefore || d.validUntil - d.notBefore > 300000)
    throw Error('publication_client_deadline'); return Object.freeze({ ...v, owner: boundOwner, deadline: Object.freeze(d) }); }
export function parsePublicationObservation(raw, original, boundOwner) { boundOwner = owner(boundOwner); const v = snapshot(raw, ['status', 'owner', 'operationId', 'fullTupleHash', 'businessRevision', 'currentVerification']); id(v.operationId); if (json(owner(v.owner)) !== json(boundOwner) || v.fullTupleHash !== original.fullTupleHash || !['committed', 'cancelled', 'unknown'].includes(v.status) || !['valid', 'needs_revalidation', 'unavailable'].includes(v.currentVerification) || !Number.isSafeInteger(v.businessRevision) || v.businessRevision < 1)
    throw Error('publication_client_binding'); return Object.freeze({ ...v, owner: boundOwner }); }
/** Signed transport client. Results are observations, never local write grants.
 * Only the original prepared object can request its one native approval. */
export function createPublicationClient(input) {
    const boundOwner = owner(input.owner), source = input.requestSource, call = input.transport.call.bind(input.transport), pending = new WeakSet();
    if (!['user', 'agent', 'scheduler'].includes(source))
        throw Error('publication_client_source');
    const challenge = (raw) => parsePublicationChallenge(raw, boundOwner);
    const observation = (raw, original) => parsePublicationObservation(raw, original, boundOwner);
    function ownerObservation(raw) {
        const v = snapshot(raw, ['owner', 'businessRevision', 'currentVerification', 'publication']);
        if (json(owner(v.owner)) !== json(boundOwner) || !Number.isSafeInteger(v.businessRevision) || v.businessRevision < 0 || !['valid', 'needs_revalidation', 'unavailable'].includes(v.currentVerification))
            throw Error('publication_client_binding');
        const p = snapshot(v.publication, v.publication?.status === 'absent' ? ['status'] : ['status', 'current', 'operationId', 'fullTupleHash']);
        if (p.status !== 'absent') {
            id(p.operationId);
            if (!['committed', 'cancelled', 'unknown'].includes(p.status) || typeof p.current !== 'boolean' || !/^[a-f0-9]{64}$/.test(p.fullTupleHash) || (p.current && (p.status !== 'committed' || v.currentVerification !== 'valid')))
                throw Error('publication_client_binding');
        }
        return Object.freeze({ ...v, owner: boundOwner, publication: Object.freeze(p) });
    }
    async function readPayload(raw, signal) {
        const expected = ownerObservation(raw), publication = expected.publication;
        if (publication.status !== 'committed' || !publication.current)
            throw Error('publication_client_not_current');
        let offset = 0, total, payloadHash;
        const chunks = [];
        do {
            signal?.throwIfAborted();
            const page = snapshot(await call('publication.readOwnerPayload', { ownerKind: boundOwner.ownerKind, ownerId: boundOwner.ownerId, operationId: publication.operationId, fullTupleHash: publication.fullTupleHash, offset, maxBytes: 262144 }, signal), ['owner', 'businessRevision', 'operationId', 'fullTupleHash', 'payloadHash', 'totalBytes', 'offset', 'bytes', 'eof']);
            if (json(owner(page.owner)) !== json(boundOwner) || page.businessRevision !== expected.businessRevision || page.operationId !== publication.operationId || page.fullTupleHash !== publication.fullTupleHash || !Number.isSafeInteger(page.totalBytes) || page.totalBytes < 1 || page.totalBytes > 32 * 1024 ** 2 || typeof page.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(page.payloadHash) || page.offset !== offset || typeof page.bytes !== 'string' || page.bytes.length > 349528 || typeof page.eof !== 'boolean')
                throw Error('publication_client_payload_page');
            if (total !== undefined && (total !== page.totalBytes || payloadHash !== page.payloadHash))
                throw Error('publication_client_payload_changed');
            total = page.totalBytes;
            payloadHash = page.payloadHash;
            const bytes = Buffer.from(page.bytes, 'base64');
            if (bytes.toString('base64') !== page.bytes || bytes.length > 262144 || offset + bytes.length > total || page.eof !== (offset + bytes.length === total) || (!bytes.length && !page.eof))
                throw Error('publication_client_payload_page');
            chunks.push(bytes);
            offset += bytes.length;
            if (page.eof)
                break;
        } while (true);
        signal?.throwIfAborted();
        const bytes = Buffer.concat(chunks, offset);
        if (createHash('sha256').update(bytes).digest('hex') !== payloadHash)
            throw Error('publication_client_payload_hash');
        return Object.freeze({ owner: boundOwner, businessRevision: expected.businessRevision, operationId: publication.operationId, fullTupleHash: publication.fullTupleHash, payloadHash: payloadHash, bytes });
    }
    return Object.freeze({
        readPayload,
        async prepareRequest(requestId, signal) { id(requestId); const result = challenge(await call('publication.prepareRequest', { ownerKind: boundOwner.ownerKind, ownerId: boundOwner.ownerId, requestSource: source, requestId }, signal)); pending.add(result); return result; },
        async lookupRequest(requestId, signal) { id(requestId); const raw = await call('publication.lookupRequest', { requestId }, signal), v = snapshot(raw, ['absent', 'not_prepared'].includes(raw?.state) ? ['state'] : ['state', 'challenge']); if (v.state === 'absent')
            return Object.freeze({ state: 'absent' }); if (v.state === 'not_prepared')
            return Object.freeze({ state: 'not_prepared' }); if (v.state !== 'prepared')
            throw Error('publication_client_request'); return Object.freeze({ state: 'prepared', challenge: challenge(v.challenge) }); },
        async recoverRequest(requestId, signal) { id(requestId); const raw = await call('publication.recoverRequest', { ownerKind: boundOwner.ownerKind, ownerId: boundOwner.ownerId, requestSource: source, requestId }, signal); const v = snapshot(raw, raw?.status === 'not_prepared' ? ['status'] : ['status', 'owner', 'challengeId', 'operationId', 'fullTupleHash', 'challenge']); if (v.status === 'not_prepared')
            return Object.freeze({ status: 'not_prepared' }); const original = challenge(v.challenge); id(v.operationId); if (!['not_approved', 'settlement_exists'].includes(v.status) || json(owner(v.owner)) !== json(boundOwner) || v.challengeId !== original.challengeId || v.fullTupleHash !== original.fullTupleHash)
            throw Error('publication_client_recovery'); return Object.freeze({ ...v, owner: boundOwner, challenge: original }); },
        async recoverUnapproved(record, signal) { const original = challenge(record), v = snapshot(await call('publication.recoverUnapproved', { challengeId: original.challengeId }, signal), ['status', 'owner', 'challengeId', 'operationId', 'fullTupleHash']); id(v.operationId); if (!['not_approved', 'settlement_exists'].includes(v.status) || json(owner(v.owner)) !== json(boundOwner) || v.challengeId !== original.challengeId || v.fullTupleHash !== original.fullTupleHash)
            throw Error('publication_client_recovery'); return Object.freeze({ ...v, owner: boundOwner }); },
        async observe(signal) { return ownerObservation(await call('publication.observeOwner', { ownerKind: boundOwner.ownerKind, ownerId: boundOwner.ownerId }, signal)); },
        async prepare(signal) { const result = challenge(await call('publication.prepare', { ownerKind: boundOwner.ownerKind, ownerId: boundOwner.ownerId, requestSource: source }, signal)); pending.add(result); return result; },
        async approve(ticket, signal) { if (!pending.has(ticket))
            throw Error('publication_client_challenge'); pending.delete(ticket); const original = challenge(ticket); return observation(await call('publication.approve', { challengeId: original.challengeId }, signal), original); },
        async recoverExpired(record, signal) { const original = challenge(record); return observation(await call('publication.recoverExpired', { challengeId: original.challengeId }, signal), original); },
        // Restart recovery accepts persisted identity only for a read, never replaying approval/commit.
        async reconcile(record, signal) { const original = challenge(record); return observation(await call('publication.reconcile', { challengeId: original.challengeId }, signal), original); },
    });
}
