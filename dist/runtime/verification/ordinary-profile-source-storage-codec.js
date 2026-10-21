import { types as nodeTypes } from 'node:util';
// Private startup references. Descriptor inspection never invokes an input getter/trap.
const initialProxy = nodeTypes.isProxy, initialPrototype = Object.getPrototypeOf;
const initialDescriptor = Object.getOwnPropertyDescriptor, initialDescriptors = Object.getOwnPropertyDescriptors;
const initialKeys = Reflect.ownKeys, initialDefine = Object.defineProperty;
const initialArray = Array.isArray, initialInteger = Number.isSafeInteger;
const initialJson = JSON.stringify, initialApply = Reflect.apply, initialRegex = RegExp.prototype.test;
const initialObjectPrototype = Object.prototype, initialArrayPrototype = Array.prototype;
const initialByteLength = Buffer.byteLength, initialBigInt = BigInt;
const initialWeakSet = WeakSet, initialWeakHas = WeakSet.prototype.has, initialWeakAdd = WeakSet.prototype.add, initialWeakDelete = WeakSet.prototype.delete;
function descriptorPart(value, key) {
    if (!value)
        return undefined;
    const part = initialDescriptor(value, key);
    return part ? part.value : undefined;
}
const witnesses = [];
function witness(target, key) { witnesses.push({ target, key, descriptor: initialDescriptor(target, key) }); }
witness(Array, Symbol.species);
witness(Array.prototype, 'constructor');
witness(Array.prototype, Symbol.iterator);
witness(Object.prototype, 'toJSON');
witness(Array.prototype, 'toJSON');
for (const key of ['Array', 'Object', 'JSON', 'Set', 'Number', 'BigInt'])
    witness(globalThis, key);
for (const key of ['map', 'some', 'flatMap', 'sort', 'join', 'includes'])
    witness(Array.prototype, key);
for (const key of ['keys', 'freeze'])
    witness(Object, key);
witness(JSON, 'stringify');
witness(Number, 'isSafeInteger');
witness(RegExp.prototype, 'test');
witness(Set.prototype, 'has');
witness(Set.prototype, 'add');
witness(Buffer, 'byteLength');
function assertAmbient() {
    for (let i = 0; i < witnesses.length; i++) {
        const item = witnesses[i];
        const current = initialDescriptor(item.target, item.key), prior = item.descriptor;
        if ((current === undefined) !== (prior === undefined))
            schema();
        const parts = ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'];
        for (let j = 0; j < parts.length; j++)
            if (descriptorPart(current, parts[j]) !== descriptorPart(prior, parts[j]))
                schema();
    }
}
function put(target, key, value) {
    initialDefine(target, key, { __proto__: null, value, enumerable: true, writable: true, configurable: true });
}
/** Snapshot only finite own DATA, plain/null records and dense standard arrays.
 * Fixed registry formats need <16 levels. No user map, iterator, toJSON or Proxy trap. */
function snapshotData(raw) {
    const ancestors = new initialWeakSet();
    let nodes = 0;
    function visit(value, depth) {
        if (++nodes > ORDINARY_REGISTRY_STORAGE_MAX_BYTES || depth > 16)
            schema();
        if (value === null || typeof value === 'string' || typeof value === 'boolean')
            return value;
        if (typeof value === 'number' && initialInteger(value))
            return value;
        if (!value || typeof value !== 'object' || initialProxy(value))
            schema();
        const array = initialArray(value), proto = initialPrototype(value);
        if (array ? proto !== initialArrayPrototype : proto !== initialObjectPrototype && proto !== null)
            schema();
        if (initialApply(initialWeakHas, ancestors, [value]))
            schema();
        initialApply(initialWeakAdd, ancestors, [value]);
        try {
            const descriptors = initialDescriptors(value), keys = initialKeys(descriptors);
            const result = array ? [] : { __proto__: null };
            let length = 0;
            if (array) {
                const lengthDescriptor = initialDescriptor(descriptors, 'length');
                const actualLengthDescriptor = lengthDescriptor?.value;
                const size = descriptorPart(actualLengthDescriptor, 'value');
                if (typeof size !== 'number' || !initialInteger(size) || size < 0 || size > ORDINARY_REGISTRY_STORAGE_MAX_BYTES || keys.length !== size + 1)
                    schema();
                length = size;
            }
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                if (array && key === 'length')
                    continue;
                if (typeof key !== 'string' || key === 'toJSON')
                    schema();
                const slot = initialDescriptor(descriptors, key);
                const descriptor = slot?.value;
                if (!descriptor || !initialDescriptor(descriptor, 'value') || descriptorPart(descriptor, 'enumerable') !== true)
                    schema();
                if (array) {
                    const index = +key;
                    if (!initialInteger(index) || index < 0 || index >= length || String(index) !== key)
                        schema();
                }
                put(result, key, visit(descriptorPart(descriptor, 'value'), depth + 1));
            }
            return result;
        }
        finally {
            initialApply(initialWeakDelete, ancestors, [value]);
        }
    }
    return visit(raw, 0);
}
function ownVersion(raw) {
    if (!raw || typeof raw !== 'object')
        return undefined;
    if (initialProxy(raw))
        schema();
    const descriptor = initialDescriptor(raw, 'version');
    if (descriptor && !initialDescriptor(descriptor, 'value'))
        schema();
    return descriptorPart(descriptor, 'value');
}
function admitHeader(raw) {
    if (!raw || typeof raw !== 'object' || initialProxy(raw))
        schema();
    const uidDescriptor = initialDescriptor(raw, 'uid'), generationDescriptor = initialDescriptor(raw, 'generation');
    if (!uidDescriptor || !generationDescriptor || !initialDescriptor(uidDescriptor, 'value') || !initialDescriptor(generationDescriptor, 'value'))
        schema();
    const uid = descriptorPart(uidDescriptor, 'value'), generation = descriptorPart(generationDescriptor, 'value');
    if (typeof uid !== 'number' || !initialInteger(uid) || uid < 0 || typeof generation !== 'string'
        || generation.length > 20 || !initialApply(initialRegex, /^(0|[1-9][0-9]*)$/, [generation])
        || generation === '0' || initialBigInt(generation) > (1n << 64n) - 1n)
        schema();
}
// Storage representation only. No authority, physical-source or profile producer.
export const ORDINARY_REGISTRY_STORAGE_MAX_BYTES = 512 * 1024;
// NEW explicit decoded-JSON budget; not a change to the on-disk/read byte gate.
export const ORDINARY_REGISTRY_DECODED_MAX_BYTES = 4 * ORDINARY_REGISTRY_STORAGE_MAX_BYTES;
const HASH = /^[a-f0-9]{64}$/;
function schema() { throw Error('profile_source_registry_schema'); }
function capacity() { throw Error('profile_source_registry_capacity'); }
function fields(value, names) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== names.sort().join(','))
        schema();
    return value;
}
function tuple(value, size) {
    if (!Array.isArray(value) || value.length !== size
        || Object.keys(value).length !== size)
        schema();
    return value;
}
function text(value) { if (typeof value !== 'string')
    schema(); return value; }
function hash(value) { const result = text(value); if (!HASH.test(result))
    schema(); return result; }
function strings(value) {
    if (!Array.isArray(value) || Object.keys(value).length !== value.length)
        schema();
    return value.map(text);
}
function decodeHistory(value) {
    const [components, rawObservations] = tuple(value, 2);
    if (!Array.isArray(rawObservations) || Object.keys(rawObservations).length !== rawObservations.length)
        schema();
    const observations = rawObservations.map(raw => {
        const [entries, revision, layoutHash] = tuple(raw, 3);
        if (typeof revision !== 'number' || !Number.isSafeInteger(revision))
            schema();
        return { version: 1, components: strings(entries), layoutRevision: revision, layoutHash: hash(layoutHash) };
    });
    return { historyUnknown: true, components: strings(components), observations };
}
/** Accepts old objects unchanged; callers MUST retain the full original DTO validator. */
export function decodeOrdinaryProfileSourceStorage(raw) {
    assertAmbient();
    if (ownVersion(raw) !== 3)
        return raw;
    admitHeader(raw);
    raw = snapshotData(raw);
    const envelope = fields(raw, ['version', 'sourceVersion', 'uid', 'generation', 'legacyInventoryRequired', 'sources']);
    if (envelope.sourceVersion !== 1 && envelope.sourceVersion !== 2)
        schema();
    if (envelope.legacyInventoryRequired !== true || !Array.isArray(envelope.sources)
        || !envelope.sources.length || Object.keys(envelope.sources).length !== envelope.sources.length)
        schema();
    const rawBytes = initialByteLength(initialJson(raw));
    if (rawBytes > ORDINARY_REGISTRY_STORAGE_MAX_BYTES)
        capacity();
    const sources = envelope.sources.map(entry => {
        const [sourceId, namespaceId, kind, canonicalPath, device, inode, snapshotFormat, db, history] = tuple(entry, 9);
        const directory = { canonicalPath: text(canonicalPath), device: text(device), inode: text(inode) };
        let database;
        if (db !== null) {
            const [basename, databaseDevice, databaseInode] = tuple(db, 3);
            database = { basename: text(basename), device: text(databaseDevice), inode: text(databaseInode) };
        }
        return { sourceId: hash(sourceId), namespaceId: hash(namespaceId), kind: text(kind), directory,
            snapshotFormat: text(snapshotFormat), ...(database ? { database } : {}),
            ...(history === null ? {} : { componentHistory: decodeHistory(history) }) };
    });
    const decoded = { version: envelope.sourceVersion, uid: envelope.uid, generation: envelope.generation,
        legacyInventoryRequired: true, sources };
    if (initialByteLength(initialJson(decoded)) > ORDINARY_REGISTRY_DECODED_MAX_BYTES)
        capacity();
    return decoded;
}
/** Input is the original fully validated public DTO. No deduplication or record removal. */
export function encodeOrdinaryProfileSourceStorage(facts) {
    assertAmbient();
    admitHeader(facts);
    facts = snapshotData(facts);
    return { version: 3, sourceVersion: facts.version, uid: facts.uid, generation: facts.generation,
        legacyInventoryRequired: true, sources: facts.sources.map(row => [
            row.sourceId, row.namespaceId, row.kind, row.directory.canonicalPath, row.directory.device,
            row.directory.inode, row.snapshotFormat,
            row.database ? [row.database.basename, row.database.device, row.database.inode] : null,
            row.componentHistory ? [[...row.componentHistory.components],
                row.componentHistory.observations.map(layout => [[...layout.components], layout.layoutRevision, layout.layoutHash])] : null,
        ]) };
}
/** Keep existing flat bytes until they no longer fit; never rewrite on a read or no-op registration. */
export function serializeOrdinaryProfileSourceStorage(facts) {
    assertAmbient();
    admitHeader(facts);
    facts = snapshotData(facts);
    const expanded = initialJson(facts);
    const expandedBytes = Buffer.byteLength(expanded);
    if (expandedBytes > ORDINARY_REGISTRY_DECODED_MAX_BYTES)
        capacity();
    if (expandedBytes <= ORDINARY_REGISTRY_STORAGE_MAX_BYTES)
        return expanded;
    const compact = initialJson(encodeOrdinaryProfileSourceStorage(facts));
    if (Buffer.byteLength(compact) > ORDINARY_REGISTRY_STORAGE_MAX_BYTES)
        capacity();
    return compact;
}
