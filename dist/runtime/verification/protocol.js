import { createHash } from 'node:crypto';
/** A direct identifier can never alias an inherited identity, regardless of its text. */
export function verificationDependencyKey(value) {
    return canonicalVerificationJson(value.kind === 'inherited'
        ? ['inherited', value.originOwner, value.originalObligationId] : ['direct', value.obligationId]);
}
export function compareVerificationDependencies(a, b) {
    const x = verificationDependencyKey(a), y = verificationDependencyKey(b);
    return x < y ? -1 : x > y ? 1 : 0;
}
export const VERIFICATION_BUDGET = Object.freeze({
    profileBytes: 2048 * 1024 ** 2, controlDatabaseBytes: 128 * 1024 ** 2,
    rollbackAndTemporaryBytes: 144 * 1024 ** 2, outboxPayloadBytes: 32 * 1024 ** 2,
    auxiliaryBytes: 16 * 1024 ** 2, maximumCounterOwners: 64, counterOwnerBytes: 4 * 1024 ** 2,
    archiveBytes: 1472 * 1024 ** 2, sessionBytes: 256 * 1024 ** 2, recordBytes: 16 * 1024 ** 2,
    maximumOutboxRecords: 4096, maximumObligationsPerOwner: 256, maximumObligationsPerProfile: 4096, maximumExecutionAttempts: 131072, maximumChecks: 4096, rpcBytes: 1024 ** 2,
});
const dependencyFields = {
    obligationId: 'id', predicateId: 'id', predicateVersion: 'id', definitionHash: 'hash', activeAttemptId: 'id',
    attemptEpoch: 'integer', sourceRunId: 'id', runNonce: 'id', subjectId: 'id', contentRoot: 'hash', coreId: 'id',
    coreHash: 'hash', coreFinalRevision: 'integer', proofId: 'id', proofHash: 'hash', proofRevision: 'integer',
    requiredScopeId: 'id', scopeRevision: 'integer', invalidationEpoch: 'integer',
};
const tupleFields = {
    schemaVersion: 'integer', profileId: 'id', ownerKind: 'id', ownerId: 'id', migrationEpoch: 'integer',
    expectedBusinessRevision: 'integer', obligationSetRevision: 'integer', obligationSetHash: 'hash',
    operationId: 'id', immutablePayloadHash: 'hash', receiverId: 'id', receiverProtocolVersion: 'integer',
    receiverInstanceEpoch: 'integer', reservationId: 'id', nonce: 'id', notBefore: 'integer', validUntil: 'integer',
    clockDomainId: 'id', clockQualificationEpoch: 'integer',
};
function record(input) {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input)))
        if (!('value' in descriptor))
            throw Error('verification_accessor_denied');
    return input;
}
function fields(input, expected, extra = []) {
    const keys = Object.keys(input);
    if (keys.length !== Object.keys(expected).length + extra.length || keys.some(k => !Object.hasOwn(expected, k) && !extra.includes(k)))
        throw Error('verification_tuple_fields');
    for (const [key, kind] of Object.entries(expected)) {
        const value = input[key];
        if (kind === 'integer') {
            if (!Number.isSafeInteger(value) || value < 0)
                throw Error('verification_invalid_integer');
        }
        else if (typeof value !== 'string' || (kind === 'hash' ? !/^[a-f0-9]{64}$/.test(value) : !value.length || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value)))
            throw Error('verification_invalid_string');
    }
}
export function parseVerificationTuple(input) {
    const value = record(input);
    fields(value, tupleFields, ['obligations']);
    if (value.schemaVersion !== 1 || value.receiverProtocolVersion !== 1 || !['task', 'intent', 'goal', 'loop', 'project'].includes(value.ownerKind))
        throw Error('verification_protocol_version');
    if (value.validUntil <= value.notBefore)
        throw Error('verification_invalid_window');
    if (!Array.isArray(value.obligations) || !value.obligations.length || value.obligations.length > VERIFICATION_BUDGET.maximumObligationsPerOwner)
        throw Error('verification_obligation_count');
    const obligations = value.obligations.map(raw => {
        const item = record(raw);
        if (item.kind === 'inherited') {
            fields(item, { ...dependencyFields, kind: 'id', originalObligationId: 'id' }, ['originOwner']);
            const origin = record(item.originOwner);
            fields(origin, { profileId: 'id', ownerKind: 'id', ownerId: 'id' });
            if (!['task', 'intent', 'goal', 'loop', 'project'].includes(origin.ownerKind) || origin.profileId !== value.profileId || item.originalObligationId !== item.obligationId || origin.ownerKind === value.ownerKind && origin.ownerId === value.ownerId)
                throw Error('verification_dependency_origin');
            return Object.freeze({ ...item, originOwner: Object.freeze({ ...origin }) });
        }
        fields(item, dependencyFields);
        return Object.freeze({ ...item });
    });
    obligations.sort(compareVerificationDependencies);
    if (new Set(obligations.map(verificationDependencyKey)).size !== obligations.length)
        throw Error('verification_duplicate_obligation');
    const result = Object.freeze({ ...value, obligations: Object.freeze(obligations) });
    if (Buffer.byteLength(canonicalVerificationJson(result)) > VERIFICATION_BUDGET.rpcBytes)
        throw Error('verification_rpc_limit');
    return result;
}
export function canonicalVerificationJson(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string')
        return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value))
        return JSON.stringify(value);
    if (Array.isArray(value))
        return '[' + value.map(canonicalVerificationJson).join(',') + ']';
    const object = record(value);
    return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonicalVerificationJson(object[key])).join(',') + '}';
}
export function hashVerificationTuple(value) {
    return createHash('sha256').update(canonicalVerificationJson(parseVerificationTuple(value))).digest('hex');
}
const transitions = {
    attempt: { prepared: ['running', 'unknown', 'cancelled_before_dispatch'], running: ['termination_pending', 'unknown', 'terminal'], termination_pending: ['unknown', 'terminal'], unknown: ['terminal'], terminal: ['superseded'] },
    proof: { pending: ['pass', 'fail', 'unverified'], pass: ['revoked', 'superseded', 'expired'] },
    settlement: { prepared: ['committed', 'aborted'] },
    outbox: { staged: ['ready', 'failed_before_dispatch', 'cancelled'], ready: ['dispatching', 'failed_before_dispatch', 'cancelled'], dispatching: ['receiver_committed', 'delivery_unknown', 'cancelled'], delivery_unknown: ['receiver_committed', 'cancelled'] },
    reservation: { pending: ['commit_authorized', 'cancelled'], commit_authorized: ['consumed', 'cancelled'] },
    revocation: { active: ['revocation_pending'], revocation_pending: ['revoked'] },
    obligation: { registered_unsatisfied: ['satisfied'], satisfied: ['registered_unsatisfied'] },
    receiver: { prepared: ['committed', 'cancelled'] },
};
/** Structural edge check only; service must also enforce source, facts, tuple and revision. */
export function assertVerificationTransition(kind, from, to) {
    if (!Object.hasOwn(transitions, kind) || !Object.hasOwn(transitions[kind], from) || !transitions[kind][from].includes(to))
        throw Error('verification_illegal_transition');
}
