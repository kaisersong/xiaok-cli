import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
export const COMPOUND_TREE_LIMITS = Object.freeze({ active: 256, identities: 4096, bytes: 16 * 1024 * 1024, indexBytes: 1024 * 1024, sessionMetadataBytes: 8192, recordBytes: 32768, tombstoneBytes: 1024 });
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v);
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function fail() { throw Error('compound_tree_invalid'); }
function exact(v, keys) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k)) || Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !('value' in d)))
        fail();
}
function input(r) {
    exact(r.dispatch, ['sessionIdentity', 'hostProviderInvocationId', 'originalToolUseId']);
    if (!Object.values(r.dispatch).every(id) || !hash(r.inputHash) || !['native', 'provider', 'delegation', 'turn'].includes(r.recordKind))
        fail();
}
const key = (r) => JSON.stringify([r.dispatch.sessionIdentity, r.dispatch.hostProviderInvocationId, r.dispatch.originalToolUseId]);
export function validateCompoundTreeBudget(value) {
    exact(value, ['version', 'rootSessionIdentity', 'generation', 'allocations']);
    if (value.version !== 1 || !id(value.rootSessionIdentity) || !Number.isSafeInteger(value.generation) || value.generation < 0 || !Array.isArray(value.allocations))
        fail();
    const budget = value, keys = new Set(), ids = new Set(), sessions = new Set([budget.rootSessionIdentity]);
    let active = 0;
    for (const row of budget.allocations) {
        exact(row, ['dispatch', 'inputHash', 'recordKind', 'id', 'state']);
        input(row);
        if (!id(row.id) || !['reserved', 'tombstone'].includes(row.state) || keys.has(key(row)) || ids.has(row.id))
            fail();
        keys.add(key(row));
        ids.add(row.id);
        sessions.add(row.dispatch.sessionIdentity);
        if (row.state === 'reserved')
            active++;
    }
    // Includes each record's atomic temporary copy and pre-reserved tombstone,
    // plus root index and per-session metadata copies. Counts are ceilings only.
    const l = COMPOUND_TREE_LIMITS;
    const bytes = 2 * l.indexBytes + 2 * sessions.size * l.sessionMetadataBytes + 2 * active * (l.recordBytes + l.tombstoneBytes) + 2 * (budget.allocations.length - active) * l.tombstoneBytes;
    if (active > l.active || budget.allocations.length > l.identities || bytes > l.bytes || Buffer.byteLength(JSON.stringify(budget)) > l.indexBytes)
        throw Error('compound_tree_capacity');
    return structuredClone(budget);
}
export function reserveCompoundTreeAllocation(previous, rootSessionIdentity, value) {
    exact(value, ['dispatch', 'inputHash', 'recordKind']);
    input(value);
    if (!id(rootSessionIdentity))
        fail();
    const budget = previous ? validateCompoundTreeBudget(previous) : { version: 1, rootSessionIdentity, generation: 0, allocations: [] };
    if (budget.rootSessionIdentity !== rootSessionIdentity)
        throw Error('compound_tree_root_mismatch');
    const old = budget.allocations.find(row => key(row) === key(value));
    if (old) {
        if (old.inputHash !== value.inputHash || old.recordKind !== value.recordKind)
            throw Error('compound_tree_identity_conflict');
        return { budget, allocationId: old.id, created: false };
    }
    const allocation = { ...structuredClone(value), id: randomUUID(), state: 'reserved' };
    budget.allocations.push(allocation);
    budget.generation++;
    return { budget: validateCompoundTreeBudget(budget), allocationId: allocation.id, created: true };
}
export function mergeCompoundTreeBudgets(previous, next) {
    if (!previous)
        return next === undefined ? undefined : validateCompoundTreeBudget(next);
    const old = validateCompoundTreeBudget(previous);
    if (!next)
        throw Error('compound_tree_regression');
    const current = validateCompoundTreeBudget(next);
    if (old.rootSessionIdentity !== current.rootSessionIdentity || current.generation < old.generation || (current.generation === old.generation && !isDeepStrictEqual(old, current)))
        throw Error('compound_tree_regression');
    for (const row of old.allocations) {
        const updated = current.allocations.find(r => r.id === row.id);
        if (!updated || !isDeepStrictEqual({ ...row, state: updated.state }, updated) || (row.state === 'tombstone' && updated.state !== 'tombstone'))
            throw Error('compound_tree_regression');
    }
    return current;
}
