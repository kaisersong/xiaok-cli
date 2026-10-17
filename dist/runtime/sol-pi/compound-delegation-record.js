import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
function fail() { throw Error('compound_delegation_invalid'); }
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v);
export function validateCompoundDelegationRecord(value) {
    const keys = ['version', 'admissionId', 'childSessionIdentity', 'childStoreRoot', 'generation', 'state', 'childPhase', ...(value && typeof value === 'object' && Object.hasOwn(value, 'managed') ? ['managed'] : [])];
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k)) || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d)))
        fail();
    const r = value;
    if (r.version !== 1 || !id(r.admissionId) || !id(r.childSessionIdentity) || typeof r.childStoreRoot !== 'string' || !r.childStoreRoot || Buffer.byteLength(r.childStoreRoot) > 4096 || !Number.isSafeInteger(r.generation) || r.generation < 1 || !['live', 'revoked', 'closed'].includes(r.state) || !['not_started', 'running', 'drained', 'unknown'].includes(r.childPhase))
        fail();
    if (r.managed !== undefined)
        validateManaged(r.managed);
    if (r.state === 'closed' && r.childPhase !== 'drained')
        fail();
    if (r.childPhase === 'drained' && r.state !== 'closed')
        fail();
}
function validateManaged(value) {
    const keys = ['version', 'groupId', 'agentId', 'rootEpoch', 'operationId', 'nativeInvocationId', 'ackBytes', 'ackHash', 'ackReady', 'ackPublished', 'resourcesReleasedDigest'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d)))
        fail();
    if (value.version !== 1 || ![value.groupId, value.agentId, value.operationId, value.nativeInvocationId].every(id) || !Number.isSafeInteger(value.rootEpoch) || value.rootEpoch < 1 || typeof value.ackBytes !== 'string' || Buffer.byteLength(value.ackBytes) > 8192 || !value.ackBytes || createHash('sha256').update(value.ackBytes).digest('hex') !== value.ackHash || typeof value.ackReady !== 'boolean' || typeof value.ackPublished !== 'boolean' || (value.ackPublished && !value.ackReady) || !(value.resourcesReleasedDigest === null || typeof value.resourcesReleasedDigest === 'string' && /^[a-f0-9]{64}$/.test(value.resourcesReleasedDigest)))
        fail();
}
export function assertCompoundDelegationTransition(previous, next) {
    validateCompoundDelegationRecord(previous);
    validateCompoundDelegationRecord(next);
    for (const key of ['version', 'admissionId', 'childSessionIdentity', 'childStoreRoot'])
        if (!isDeepStrictEqual(previous[key], next[key]))
            fail();
    if (previous.managed || next.managed) {
        if (!previous.managed || !next.managed)
            fail();
        const a = previous.managed, b = next.managed;
        if (!isDeepStrictEqual({ ...a, ackReady: b.ackReady, ackPublished: b.ackPublished, resourcesReleasedDigest: b.resourcesReleasedDigest }, b) || a.ackReady && !b.ackReady || a.ackPublished && !b.ackPublished || a.resourcesReleasedDigest !== null && a.resourcesReleasedDigest !== b.resourcesReleasedDigest)
            fail();
    }
    if (previous.state === 'closed' || (previous.state === 'revoked' && next.state === 'live'))
        fail();
    const increase = previous.state === 'live' && next.state !== 'live' ? 1 : 0;
    if (next.generation !== previous.generation + increase)
        fail();
    const allowed = { not_started: ['not_started', 'running', 'drained', 'unknown'], running: ['running', 'drained', 'unknown'], drained: [], unknown: ['unknown'] };
    if (!allowed[previous.childPhase].includes(next.childPhase))
        fail();
}
