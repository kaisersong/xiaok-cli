import { createHash } from 'node:crypto';
const fields = ['version', 'sessionId', 'expectedSnapshotHash', 'expectedStoreRevision', 'migrationId', 'targetAuthorityId', 'targetSessionId', 'migrationEpoch', 'importReceiptHash'];
export function captureMigrationMarker(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('session_migration_invalid');
    const r = value;
    if (Object.keys(r).length !== fields.length || fields.some(k => !Object.hasOwn(r, k)) || Object.values(Object.getOwnPropertyDescriptors(r)).some(d => !('value' in d))
        || r.version !== 1 || !['sessionId', 'migrationId', 'targetAuthorityId', 'targetSessionId'].every(k => typeof r[k] === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(r[k]))
        || !['expectedSnapshotHash', 'importReceiptHash'].every(k => typeof r[k] === 'string' && /^[a-f0-9]{64}$/.test(r[k]))
        || !Number.isSafeInteger(r.expectedStoreRevision) || r.expectedStoreRevision < 0 || !Number.isSafeInteger(r.migrationEpoch) || r.migrationEpoch < 1)
        throw Error('session_migration_invalid');
    return Object.freeze(structuredClone(r));
}
export function migrationMarkerFromInput(input) {
    const { lease: _lease, ...facts } = input;
    return captureMigrationMarker({ version: 1, ...facts });
}
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
    return value;
}
/** Canonical full durable snapshot; distinct from provider history digest. */
export function computeSessionSnapshotHash(snapshot) {
    return createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex');
}
export function freezeMigrationSnapshot(snapshot) {
    const freeze = (value) => { if (value && typeof value === 'object') {
        for (const child of Object.values(value))
            freeze(child);
        Object.freeze(value);
    } };
    const clone = structuredClone(snapshot);
    freeze(clone);
    return clone;
}
