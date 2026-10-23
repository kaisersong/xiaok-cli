import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { COMPOUND_LIMITS, validateCompoundOperationLedger } from './compound-operation.js';
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v);
function fail() { throw Error('compound_provider_attempt_invalid'); }
function exact(v, keys) { if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k)) || Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !('value' in d)))
    fail(); }
function validateInput(r) {
    if (!id(r.issuerIncarnation) || !id(r.logicalInvocationId) || ![0, 1, 2].includes(r.attemptIndex) || !hash(r.serializedBodySha256) || !hash(r.closureDigest))
        fail();
    exact(r.destination, ['provider', 'model', 'url']);
    if (!id(r.destination.provider) || !id(r.destination.model) || typeof r.destination.url !== 'string' || r.destination.url.length > 4096)
        fail();
    let url;
    try {
        url = new URL(r.destination.url);
    }
    catch {
        fail();
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
        fail();
    if (Object.hasOwn(r, 'rootAdmission')) {
        exact(r.rootAdmission, ['rootSessionIdentity', 'authorizationId', 'generation']);
        if (!id(r.rootAdmission.rootSessionIdentity) || !id(r.rootAdmission.authorizationId) || !Number.isSafeInteger(r.rootAdmission.generation) || Number(r.rootAdmission.generation) < 1)
            fail();
    }
    else {
        exact(r.parentAdmission, ['parentSessionIdentity', 'parentOperationId', 'generation']);
        if (!id(r.parentAdmission.parentSessionIdentity) || !id(r.parentAdmission.parentOperationId) || !Number.isSafeInteger(r.parentAdmission.generation) || Number(r.parentAdmission.generation) < 0)
            fail();
    }
}
const sha = (s) => createHash('sha256').update(s).digest('hex');
function requestHash(r) { const authority = r.rootAdmission ? ['root', r.rootAdmission.rootSessionIdentity, r.rootAdmission.authorizationId, r.rootAdmission.generation] : [r.parentAdmission.parentSessionIdentity, r.parentAdmission.parentOperationId, r.parentAdmission.generation]; return sha(JSON.stringify([r.issuerIncarnation, r.logicalInvocationId, r.serializedBodySha256, r.destination.provider, r.destination.model, r.destination.url, r.closureDigest, ...authority])); }
const authorityKey = (value) => value && typeof value === 'object' && Object.hasOwn(value, 'rootAdmission') ? 'rootAdmission' : 'parentAdmission';
const attemptHash = (base, index) => sha(JSON.stringify([base, index]));
const toolId = (index) => `host-provider-attempt:${index}`;
/** Pure identity calculation shared by the root reservation and child record. */
export function getCompoundProviderAttemptIdentity(sessionIdentity, input) {
    exact(input, ['issuerIncarnation', 'logicalInvocationId', 'attemptIndex', 'serializedBodySha256', 'destination', 'closureDigest', authorityKey(input)]);
    validateInput(input);
    if (!id(sessionIdentity) || input.rootAdmission && input.rootAdmission.rootSessionIdentity !== sessionIdentity)
        fail();
    const binding = requestHash(input);
    return { dispatch: { sessionIdentity, hostProviderInvocationId: input.logicalInvocationId, originalToolUseId: toolId(input.attemptIndex) }, inputHash: attemptHash(binding, input.attemptIndex) };
}
export function validateProviderAttempt(r) {
    exact(r, ['issuerIncarnation', 'logicalInvocationId', 'attemptIndex', 'serializedBodySha256', 'destination', 'closureDigest', authorityKey(r), 'id', 'dispatch', 'inputHash', 'requestHash', 'transportState', 'reservation']);
    const value = r;
    validateInput(value);
    exact(value.dispatch, ['sessionIdentity', 'hostProviderInvocationId', 'originalToolUseId']);
    if (value.rootAdmission && value.rootAdmission.rootSessionIdentity !== value.dispatch.sessionIdentity)
        fail();
    if (!id(value.id) || !id(value.dispatch.sessionIdentity) || value.dispatch.hostProviderInvocationId !== value.logicalInvocationId || value.dispatch.originalToolUseId !== toolId(value.attemptIndex) || value.requestHash !== requestHash(value) || value.inputHash !== attemptHash(value.requestHash, value.attemptIndex) || !['reserved', 'drained', 'cancelled_before_send', 'unknown'].includes(value.transportState))
        fail();
    exact(value.reservation, ['recordBytes', 'tombstoneBytes', 'tombstoneSlot']);
    if (value.reservation.recordBytes !== COMPOUND_LIMITS.recordBytes || value.reservation.tombstoneBytes !== COMPOUND_LIMITS.tombstoneBytes || value.reservation.tombstoneSlot !== 1 || Buffer.byteLength(JSON.stringify(value)) > COMPOUND_LIMITS.recordBytes)
        fail();
}
export function validateProviderTombstone(t) {
    const p = t.providerAttempt;
    if (!p)
        fail();
    exact(p, ['logicalInvocationId', 'attemptIndex', 'requestHash', 'transportState']);
    if (!id(p.logicalInvocationId) || ![0, 1, 2].includes(p.attemptIndex) || !hash(p.requestHash) || !['drained', 'cancelled_before_send'].includes(p.transportState) || t.dispatch.hostProviderInvocationId !== p.logicalInvocationId || t.dispatch.originalToolUseId !== toolId(p.attemptIndex) || t.inputHash !== attemptHash(p.requestHash, p.attemptIndex))
        fail();
}
export function assertProviderAttemptTransition(previous, next) {
    if (previous.transportState !== 'reserved' || !['drained', 'cancelled_before_send', 'unknown'].includes(next.transportState) || !isDeepStrictEqual({ ...previous, transportState: next.transportState }, next))
        throw Error('compound_provider_attempt_transition');
}
export function reserveProviderAttempt(value, sessionIdentity, input) {
    exact(input, ['issuerIncarnation', 'logicalInvocationId', 'attemptIndex', 'serializedBodySha256', 'destination', 'closureDigest', authorityKey(input)]);
    const ledger = validateCompoundOperationLedger(value);
    validateInput(input);
    if (!id(sessionIdentity) || input.rootAdmission && input.rootAdmission.rootSessionIdentity !== sessionIdentity)
        fail();
    const binding = requestHash(input), { dispatch, inputHash } = getCompoundProviderAttemptIdentity(sessionIdentity, input);
    const all = [...ledger.operations, ...(ledger.directOperations ?? []), ...(ledger.providerAttempts ?? []), ...ledger.tombstones];
    const old = all.find(r => isDeepStrictEqual(r.dispatch, dispatch));
    if (old) {
        if (old.inputHash !== inputHash || (!('requestHash' in old) && !('providerAttempt' in old)))
            throw Error('dispatch_identity_conflict');
        return { ledger, reservationId: old.id, created: false, bindingHash: inputHash };
    }
    const preceding = [...(ledger.providerAttempts ?? []).filter(r => r.logicalInvocationId === input.logicalInvocationId).map(r => ({ index: r.attemptIndex, hash: r.requestHash, state: r.transportState })), ...ledger.tombstones.filter(t => t.providerAttempt?.logicalInvocationId === input.logicalInvocationId).map(t => ({ index: t.providerAttempt.attemptIndex, hash: t.providerAttempt.requestHash, state: t.providerAttempt.transportState }))];
    if (preceding.length !== input.attemptIndex || preceding.some(r => r.hash !== binding || r.state !== 'drained') || Array.from({ length: input.attemptIndex }, (_, i) => i).some(i => !preceding.some(r => r.index === i)))
        throw Error('compound_provider_retry_rejected');
    const record = { ...structuredClone(input), id: randomUUID(), dispatch, inputHash, requestHash: binding, transportState: 'reserved', reservation: { recordBytes: COMPOUND_LIMITS.recordBytes, tombstoneBytes: COMPOUND_LIMITS.tombstoneBytes, tombstoneSlot: 1 } };
    ledger.providerAttempts ??= [];
    ledger.providerAttempts.push(record);
    ledger.generation++;
    return { ledger: validateCompoundOperationLedger(ledger), reservationId: record.id, created: true, bindingHash: inputHash };
}
/** Facts only: the host transport issuer must authenticate actual close or
 * irreversible cancellation-before-consume. This function grants no permission. */
export function settleProviderAttempt(value, id, state) {
    if (!['drained', 'cancelled_before_send', 'unknown'].includes(state))
        fail();
    const ledger = validateCompoundOperationLedger(value), r = ledger.providerAttempts?.find(r => r.id === id);
    if (!r)
        fail();
    const previous = structuredClone(r);
    r.transportState = state;
    validateProviderAttempt(r);
    if (!isDeepStrictEqual(previous, r))
        assertProviderAttemptTransition(previous, r);
    ledger.generation++;
    return validateCompoundOperationLedger(ledger);
}
export function retireProviderAttempt(value, id) {
    const ledger = validateCompoundOperationLedger(value), index = ledger.providerAttempts?.findIndex(r => r.id === id) ?? -1, r = ledger.providerAttempts?.[index];
    if (!r || !['drained', 'cancelled_before_send'].includes(r.transportState))
        throw Error('compound_provider_attempt_not_closed');
    ledger.tombstones.push({ id: r.id, dispatch: r.dispatch, inputHash: r.inputHash, terminalKind: 'settled', providerAttempt: { logicalInvocationId: r.logicalInvocationId, attemptIndex: r.attemptIndex, requestHash: r.requestHash, transportState: r.transportState } });
    ledger.providerAttempts.splice(index, 1);
    ledger.generation++;
    return validateCompoundOperationLedger(ledger);
}
