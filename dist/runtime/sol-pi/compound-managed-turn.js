import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
export function getManagedTurnDispatch(record) { return { sessionIdentity: record.childSessionId, hostProviderInvocationId: `managed-turn:${createHash('sha256').update(record.admissionId).digest('hex')}`, originalToolUseId: record.operationId }; }
const identityKeys = ['admissionId', 'childSessionId', 'operationId', 'turnId', 'rootEpoch', 'inputHash', 'closureDigest'];
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(reason) { throw Error(`compound_managed_turn_${reason}`); }
function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor)))
        fail('invalid');
}
function identity(value) {
    exact(value, identityKeys);
    if (!['admissionId', 'childSessionId', 'operationId', 'turnId'].every(key => id(value[key])) || !Number.isSafeInteger(value.rootEpoch) || value.rootEpoch < 1 || !hash(value.inputHash) || !hash(value.closureDigest))
        fail('invalid');
}
const terminal = (state) => state === 'drained' || state === 'cancelled_before_activation';
/** Serialized history only: neither state nor this helper issues an execution,
 * Main approval, provider admission, or physical drain capability. */
export function validateManagedTurnLedger(value) {
    exact(value, ['version', 'records']);
    if (value.version !== 1 || !Array.isArray(value.records) || value.records.length > 128)
        fail('capacity');
    const records = [], operations = new Set(), turns = new Set();
    for (const raw of value.records) {
        exact(raw, [...identityKeys, 'generation', 'state', 'appliedDigest']);
        const { generation, state, appliedDigest, ...facts } = raw;
        identity(facts);
        if (generation !== records.length + 1 || !['prepared', 'active', 'retiring', 'drained', 'cancelled_before_activation', 'unknown'].includes(state) || !(appliedDigest === null || hash(appliedDigest)))
            fail('invalid');
        if (['active', 'retiring', 'drained'].includes(state) && appliedDigest === null || state === 'cancelled_before_activation' && appliedDigest !== null)
            fail('applied');
        const previous = records.at(-1);
        if (previous && (!terminal(previous.state) || previous.admissionId !== facts.admissionId || previous.childSessionId !== facts.childSessionId))
            fail('pending');
        if (previous && facts.rootEpoch < previous.rootEpoch)
            fail('epoch');
        if (operations.has(facts.operationId) || turns.has(facts.turnId))
            fail('identity');
        operations.add(facts.operationId);
        turns.add(facts.turnId);
        records.push({ ...facts, generation: generation, state: state, appliedDigest: appliedDigest });
    }
    const ledger = { version: 1, records };
    if (Buffer.byteLength(JSON.stringify(ledger)) > 128 * 1024)
        fail('capacity');
    return ledger;
}
export function prepareManagedTurn(previous, input) {
    identity(input);
    const ledger = previous ? validateManagedTurnLedger(previous) : { version: 1, records: [] };
    const old = ledger.records.find(row => row.operationId === input.operationId);
    if (old) {
        const { generation, state, appliedDigest, ...facts } = old;
        if (!isDeepStrictEqual(facts, input))
            fail('identity');
        return { ledger, record: structuredClone(old), created: false };
    }
    if (ledger.records.length && !terminal(ledger.records.at(-1).state))
        fail('pending');
    const record = { ...structuredClone(input), generation: ledger.records.length + 1, state: 'prepared', appliedDigest: null };
    ledger.records.push(record);
    return { ledger: validateManagedTurnLedger(ledger), record: structuredClone(record), created: true };
}
export function advanceManagedTurn(previous, generation, change) {
    const ledger = validateManagedTurnLedger(previous);
    if (!Number.isSafeInteger(generation) || generation < 1)
        fail('identity');
    exact(change, change.appliedDigest === undefined ? ['state'] : ['state', 'appliedDigest']);
    const old = ledger.records[generation - 1];
    if (!old)
        fail('identity');
    const next = { ...old, state: change.state, appliedDigest: change.appliedDigest ?? old.appliedDigest };
    if (isDeepStrictEqual(old, next))
        return ledger;
    if (generation !== ledger.records.length)
        fail('transition');
    if (change.appliedDigest !== undefined && (old.state !== 'prepared' || next.state !== 'prepared' || old.appliedDigest !== null || !hash(change.appliedDigest)))
        fail('applied');
    if (next.state === 'active' && old.appliedDigest === null || next.state === 'cancelled_before_activation' && old.appliedDigest !== null)
        fail('applied');
    const edges = { prepared: ['prepared', 'active', 'cancelled_before_activation', 'unknown'], active: ['retiring', 'unknown'], retiring: ['drained', 'unknown'], drained: [], cancelled_before_activation: [], unknown: [] };
    if (!edges[old.state].includes(next.state))
        fail('transition');
    ledger.records[generation - 1] = next;
    return validateManagedTurnLedger(ledger);
}
export function mergeManagedTurnLedgers(previous, next) {
    if (!previous)
        return next === undefined ? undefined : validateManagedTurnLedger(next);
    const old = validateManagedTurnLedger(previous);
    if (!next)
        fail('regression');
    const current = validateManagedTurnLedger(next);
    if (current.records.length < old.records.length)
        fail('regression');
    for (const row of old.records) {
        const changed = current.records[row.generation - 1];
        if (isDeepStrictEqual(row, changed))
            continue;
        const { state, appliedDigest, ...facts } = changed, { state: oldState, appliedDigest: oldApplied, ...oldFacts } = row;
        if (!isDeepStrictEqual(facts, oldFacts))
            fail('regression');
        // A commit may advance several phases, but cannot erase an applied fact or
        // rewrite a terminal/unknown record. Actual transitions are issued separately.
        const reachable = { prepared: ['prepared', 'active', 'retiring', 'drained', 'cancelled_before_activation', 'unknown'], active: ['retiring', 'drained', 'unknown'], retiring: ['drained', 'unknown'], drained: [], cancelled_before_activation: [], unknown: [] };
        if (!reachable[oldState].includes(state) || oldApplied !== null && oldApplied !== appliedDigest)
            fail('regression');
    }
    return current;
}
