import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
import { assertPublishedArtifactOwner, assertPublishedArtifactSelection } from './published-artifact-selection.js';
import { readApplicationOwnDataField } from './application-value-data.js';
import { captureApplicationData } from './application-value-data.js';
import { types } from 'node:util';
const indexes = new WeakMap();
const setHas = Set.prototype.has, apply = Reflect.apply, getPrototypeOf = Object.getPrototypeOf, setPrototype = Set.prototype;
function data(index) { const value = index && typeof index === 'object' ? indexes.get(index) : undefined; if (!value)
    throw Error('published_artifact_content_index'); return value; }
function append(target, value) { Object.defineProperty(target, `${target.length}`, { value, enumerable: true, writable: true, configurable: true }); }
function key(kind, origin, obligationId, original, path) { return json([kind, origin, obligationId, original, path]); }
export function createPublishedArtifactIndex(payloadOwner, sections, selectedKeys) {
    assertPublishedArtifactOwner(payloadOwner);
    if (!selectedKeys || typeof selectedKeys !== 'object' || types.isProxy(selectedKeys) || getPrototypeOf(selectedKeys) !== setPrototype)
        throw Error('published_artifact_shape');
    try {
        apply(setHas, selectedKeys, ['']);
    }
    catch {
        throw Error('published_artifact_shape');
    }
    const capturedSections = captureApplicationData(sections, { maximumBytes: 32 * 1024 ** 2, maximumNodes: 8_000_000, invalid: 'published_artifact_sections', limit: 'published_artifact_limit' });
    if (!Array.isArray(capturedSections) || capturedSections.length > 256)
        throw Error('published_artifact_sections');
    let encodedArtifactBytes = 0;
    const value = { ownerKey: json(payloadOwner), entries: new Map(), records: new Set(), decoded: new WeakMap(), count: 0, selectionBytes: 0 };
    for (const raw of capturedSections) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw Error('published_artifact_sections');
        const kind = readApplicationOwnDataField(raw, 'kind', 'published_artifact_sections'), s = raw, inherited = kind.kind === 'data' && kind.value === 'inherited';
        if (!Object.hasOwn(s, 'obligationId') || !Object.hasOwn(s, 'artifacts') || inherited && (!Object.hasOwn(s, 'originOwner') || !Object.hasOwn(s, 'originalObligationId')))
            throw Error('published_artifact_sections');
        const origin = inherited ? s.originOwner : payloadOwner;
        assertPublishedArtifactOwner(origin);
        const artifacts = s.artifacts;
        if (!Array.isArray(artifacts) || artifacts.length > 4096)
            throw Error('published_artifact_limit');
        for (const rawArtifact of artifacts) {
            if (!rawArtifact || typeof rawArtifact !== 'object' || Array.isArray(rawArtifact))
                throw Error('published_artifact_shape');
            if (Object.keys(rawArtifact).sort().join(',') !== 'bytesBase64,path,sha256,size')
                throw Error('published_artifact_shape');
            encodedArtifactBytes += Buffer.byteLength(json(rawArtifact));
            if (encodedArtifactBytes > 32 * 1024 ** 2)
                throw Error('published_artifact_limit');
            value.count++;
            value.selectionBytes += Buffer.byteLength(json({ kind: inherited ? 'inherited' : 'local', obligationId: s.obligationId, path: rawArtifact.path, ...(inherited ? { originOwner: origin, originalObligationId: s.originalObligationId } : {}) }));
            const k = key(inherited ? 'inherited' : 'local', origin, s.obligationId, inherited ? s.originalObligationId : null, rawArtifact.path);
            if (!apply(setHas, selectedKeys, [k]))
                continue;
            const list = value.entries.get(k);
            if (list && list.length === 2)
                continue; // Two witnesses suffice to reject ambiguity.
            const entry = Object.freeze({ path: rawArtifact.path, sha256: rawArtifact.sha256, size: rawArtifact.size, bytesBase64: rawArtifact.bytesBase64 });
            if (list)
                append(list, entry);
            else
                value.entries.set(k, [entry]);
            value.records.add(entry);
        }
    }
    const token = Object.freeze({});
    indexes.set(token, value);
    return token;
}
export function publishedArtifactPopulation(index) { const value = data(index); return Object.freeze({ count: value.count, selectionBytes: value.selectionBytes }); }
export function assertPublishedArtifactIndexOwner(index, owner) { assertPublishedArtifactOwner(owner); if (data(index).ownerKey !== json(owner))
    throw Error('published_artifact_index_owner'); }
export function publishedArtifactLookupKeys(applicationOwner, selection, allowLocalInheritance = false) {
    assertPublishedArtifactOwner(applicationOwner);
    assertPublishedArtifactSelection(selection);
    const origin = selection.kind === 'local' ? applicationOwner : selection.originOwner;
    const keys = [key(selection.kind, origin, selection.obligationId, selection.kind === 'inherited' ? selection.originalObligationId : null, selection.path)];
    if (allowLocalInheritance && selection.kind === 'local')
        keys.push(key('inherited', origin, selection.obligationId, selection.obligationId, selection.path));
    return keys;
}
export function findIndexedPublishedArtifacts(index, applicationOwner, selection, allowLocalInheritance = false) {
    const value = data(index);
    return Object.freeze(publishedArtifactLookupKeys(applicationOwner, selection, allowLocalInheritance).flatMap(k => value.entries.get(k) ?? []));
}
function decoded(index, entry) {
    const value = data(index);
    if (!value.records.has(entry))
        throw Error('published_artifact_content_index');
    const previous = value.decoded.get(entry);
    if (previous)
        return previous;
    const { size, sha256, bytesBase64 } = entry;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > 16 * 1024 ** 2 || typeof sha256 !== 'string' || typeof bytesBase64 !== 'string' || bytesBase64.length !== 4 * Math.ceil(size / 3))
        throw Error('published_artifact_content');
    const bytes = Buffer.from(bytesBase64, 'base64');
    if (bytes.length !== size || bytes.toString('base64') !== bytesBase64 || createHash('sha256').update(bytes).digest('hex') !== sha256)
        throw Error('published_artifact_content');
    value.decoded.set(entry, bytes);
    return bytes;
}
export function verifyIndexedPublishedArtifact(index, entry) { decoded(index, entry); }
export function readIndexedPublishedArtifact(index, entry) { return Buffer.from(decoded(index, entry)); }
