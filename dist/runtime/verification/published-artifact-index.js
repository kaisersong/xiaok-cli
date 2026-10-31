import { ownDataArrayIsArray, ownDataArrayPrototypeFlatMap, ownDataArrayPrototypeJoin, ownDataArrayPrototypePush, ownDataArrayPrototypeSort, ownDataBufferByteLength, ownDataBufferFrom, ownDataBufferPrototypeToString, ownDataCryptoCreateHash, ownDataHashPrototypeDigest, ownDataHashPrototypeUpdate, ownDataMapPrototypeGet, ownDataMapPrototypeSet, ownDataMathCeil, ownDataMathMax, ownDataNumber, ownDataNumberIsFinite, ownDataNumberIsSafeInteger, ownDataObjectDefineProperty, ownDataObjectFreeze, ownDataObjectHasOwn, ownDataObjectKeys, ownDataRegExpPrototypeTest, ownDataSetPrototypeAdd, ownDataSetPrototypeHas, ownDataString, ownDataUtilTypesIsProxy, ownDataWeakMapPrototypeGet, ownDataWeakMapPrototypeSet } from './application-native-intrinsics.js';
import { capturedArrayIterator, createCapturedMap, createCapturedSet, createCapturedWeakMap, createCapturedWeakSet } from './application-iteration-intrinsics.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { assertPublishedArtifactOwner, assertPublishedArtifactPath, assertPublishedArtifactSelection } from './published-artifact-selection.js';
import { applicationDataDescriptors, readApplicationOwnDataField } from './application-value-data.js';
import { captureApplicationData } from './application-value-data.js';
const indexes = createCapturedWeakMap();
const setHas = Set.prototype.has, apply = Reflect.apply, getPrototypeOf = Object.getPrototypeOf, setPrototype = Set.prototype;
const ownKeys = Reflect.ownKeys, getOwn = Object.getOwnPropertyDescriptor, hasOwn = Object.prototype.hasOwnProperty, arrayIsArray = Array.isArray, reflectGet = Reflect.get;
const weakHas = WeakSet.prototype.has, weakAdd = WeakSet.prototype.add;
const sectionFields = ['obligationId', 'definitionHash', 'binding', 'evaluation', 'artifacts', 'kind', 'originOwner', 'originalObligationId', 'application'];
const localSectionFields = ['obligationId', 'definitionHash', 'binding', 'evaluation', 'artifacts'];
const inheritedSectionFields = ['obligationId', 'definitionHash', 'binding', 'evaluation', 'artifacts', 'kind', 'originOwner', 'originalObligationId'];
const artifactFields = ['path', 'sha256', 'size', 'bytesBase64'];
function field(descriptors, name) {
    const wrapper = getOwn(descriptors, name);
    if (!wrapper || !apply(hasOwn, wrapper, ['value']))
        return undefined;
    const descriptor = apply(reflectGet, undefined, [wrapper, 'value', wrapper]);
    if (!descriptor || !apply(hasOwn, descriptor, ['value']))
        return undefined;
    return apply(reflectGet, undefined, [descriptor, 'value', descriptor]);
}
function enumerableDataField(descriptors, name) {
    const wrapper = getOwn(descriptors, name);
    if (!wrapper || !apply(hasOwn, wrapper, ['value']))
        return false;
    const descriptor = apply(reflectGet, undefined, [wrapper, 'value', wrapper]);
    return !!descriptor && !!apply(hasOwn, descriptor, ['value']) && apply(reflectGet, undefined, [descriptor, 'enumerable', descriptor]) === true;
}
function includes(values, candidate) {
    for (const value of capturedArrayIterator(values))
        if (value === candidate)
            return true;
    return false;
}
function preflightTree(value, error) {
    const seen = createCapturedWeakSet();
    let nodes = 0;
    const visit = (current, depth) => {
        if (++nodes > 8000000 || depth > 64)
            throw Error('published_artifact_limit');
        if (current === null || typeof current === 'string' || typeof current === 'boolean' || typeof current === 'number' && ownDataNumberIsFinite(current))
            return;
        if (!current || typeof current !== 'object' || ownDataUtilTypesIsProxy(current) || apply(weakHas, seen, [current]))
            throw Error(error);
        apply(weakAdd, seen, [current]);
        const descriptors = applicationDataDescriptors(current, ownDataMathMax(0, 8000000 - nodes), error), keys = ownKeys(descriptors), isArray = arrayIsArray(current);
        if (isArray) {
            const lengthDescriptor = field(descriptors, 'length');
            if (!ownDataNumberIsSafeInteger(lengthDescriptor) || ownDataNumber(lengthDescriptor) < 0 || keys.length !== ownDataNumber(lengthDescriptor) + 1)
                throw Error(error);
            for (let index = 0; index < ownDataNumber(lengthDescriptor); index++) {
                const key = ownDataString(index);
                if (!apply(hasOwn, descriptors, [key]))
                    throw Error(error);
                visit(field(descriptors, key), depth + 1);
            }
        }
        else {
            for (const key of capturedArrayIterator(keys)) {
                if (typeof key !== 'string')
                    throw Error(error);
                visit(field(descriptors, key), depth + 1);
            }
        }
    };
    visit(value, 0);
}
function preflightSections(sections) {
    if (!arrayIsArray(sections))
        throw Error('published_artifact_sections');
    const root = applicationDataDescriptors(sections, 257, 'published_artifact_sections'), length = field(root, 'length');
    if (!ownDataNumberIsSafeInteger(length) || ownDataNumber(length) > 256)
        throw Error('published_artifact_sections');
    preflightTree(sections, 'published_artifact_sections');
    for (let index = 0; index < ownDataNumber(length); index++) {
        const section = field(root, ownDataString(index));
        if (!section || typeof section !== 'object' || arrayIsArray(section))
            throw Error('published_artifact_sections');
        const descriptors = applicationDataDescriptors(section, sectionFields.length, 'published_artifact_sections'), keys = ownKeys(descriptors);
        const kind = field(descriptors, 'kind'), inherited = kind === 'inherited', expected = inherited ? inheritedSectionFields : localSectionFields, optional = field(descriptors, 'application') !== undefined;
        if (kind !== undefined && !inherited || keys.length !== expected.length + (optional ? 1 : 0))
            throw Error('published_artifact_sections');
        for (const key of capturedArrayIterator(keys))
            if (typeof key !== 'string' || !enumerableDataField(descriptors, key) || !includes(expected, key) && !(optional && key === 'application'))
                throw Error('published_artifact_sections');
        for (const required of capturedArrayIterator(expected))
            if (!apply(hasOwn, descriptors, [required]))
                throw Error('published_artifact_sections');
        if (inherited && (!apply(hasOwn, descriptors, ['originOwner']) || !apply(hasOwn, descriptors, ['originalObligationId'])))
            throw Error('published_artifact_sections');
        const obligationId = field(descriptors, 'obligationId'), definitionHash = field(descriptors, 'definitionHash');
        if (typeof obligationId !== 'string' || !obligationId || ownDataBufferByteLength(obligationId) > 160 || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, obligationId))
            throw Error('published_artifact_sections');
        if (typeof definitionHash !== 'string' || !ownDataRegExpPrototypeTest(/^[a-f0-9]{64}$/, definitionHash))
            throw Error('published_artifact_hash');
        if (inherited) {
            assertPublishedArtifactOwner(field(descriptors, 'originOwner'));
            const original = field(descriptors, 'originalObligationId');
            if (typeof original !== 'string' || !original || ownDataBufferByteLength(original) > 160 || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, original))
                throw Error('published_artifact_sections');
        }
        const artifacts = field(descriptors, 'artifacts');
        if (!arrayIsArray(artifacts) || artifacts.length > 4096)
            throw Error('published_artifact_limit');
        const artifactRoot = applicationDataDescriptors(artifacts, 4097, 'published_artifact_shape');
        for (let artifactIndex = 0; artifactIndex < artifacts.length; artifactIndex++) {
            const artifact = field(artifactRoot, ownDataString(artifactIndex));
            if (!artifact || typeof artifact !== 'object' || arrayIsArray(artifact))
                throw Error('published_artifact_shape');
            const artifactDescriptor = applicationDataDescriptors(artifact, 4, 'published_artifact_shape'), artifactKeys = ownKeys(artifactDescriptor);
            if (artifactKeys.length !== 4)
                throw Error('published_artifact_shape');
            for (const key of capturedArrayIterator(artifactKeys))
                if (typeof key !== 'string' || !enumerableDataField(artifactDescriptor, key) || !includes(artifactFields, key))
                    throw Error('published_artifact_shape');
        }
    }
    // Shape/accessor/alias validation for the complete population finishes before path conversion.
    for (let index = 0; index < ownDataNumber(length); index++) {
        const section = field(root, ownDataString(index)), artifacts = section.artifacts;
        for (let artifactIndex = 0; artifactIndex < artifacts.length; artifactIndex++) {
            const artifact = artifacts[artifactIndex], descriptors = applicationDataDescriptors(artifact, 4, 'published_artifact_shape');
            const path = field(descriptors, 'path'), sha256 = field(descriptors, 'sha256'), size = field(descriptors, 'size'), bytesBase64 = field(descriptors, 'bytesBase64');
            assertPublishedArtifactPath(path);
            if (typeof sha256 !== 'string' || !ownDataRegExpPrototypeTest(/^[a-f0-9]{64}$/, sha256))
                throw Error('published_artifact_hash');
            if (typeof size !== 'number' || !ownDataNumberIsSafeInteger(size) || size < 0 || size > 16 * 1024 ** 2 || typeof bytesBase64 !== 'string' || bytesBase64.length !== 4 * ownDataMathCeil(size / 3))
                throw Error('published_artifact_size');
        }
    }
}
function data(index) {
    const value = index && typeof index === 'object' ? ownDataWeakMapPrototypeGet(indexes, index) : undefined;
    if (!value)
        throw Error('published_artifact_content_index');
    return value;
}
function append(target, value) { ownDataObjectDefineProperty(target, `${target.length}`, { __proto__: null, value, enumerable: true, writable: true, configurable: true }); }
function key(kind, origin, obligationId, original, path) { return json([kind, origin, obligationId, original, path]); }
export function createPublishedArtifactIndex(payloadOwner, sections, selectedKeys) {
    assertPublishedArtifactOwner(payloadOwner);
    if (!selectedKeys || typeof selectedKeys !== 'object' || ownDataUtilTypesIsProxy(selectedKeys) || getPrototypeOf(selectedKeys) !== setPrototype)
        throw Error('published_artifact_shape');
    try {
        apply(setHas, selectedKeys, ['']);
    }
    catch {
        throw Error('published_artifact_shape');
    }
    preflightSections(sections);
    const capturedSections = captureApplicationData(sections, { maximumBytes: 32 * 1024 ** 2, maximumNodes: 8000000, invalid: 'published_artifact_sections', limit: 'published_artifact_limit' });
    if (!arrayIsArray(capturedSections) || capturedSections.length > 256)
        throw Error('published_artifact_sections');
    let encodedArtifactBytes = 0;
    const value = { ownerKey: json(payloadOwner), entries: createCapturedMap(), records: createCapturedSet(), decoded: createCapturedWeakMap(), count: 0, selectionBytes: 0 };
    for (const raw of capturedArrayIterator(capturedSections)) {
        if (!raw || typeof raw !== 'object' || ownDataArrayIsArray(raw))
            throw Error('published_artifact_sections');
        const kind = readApplicationOwnDataField(raw, 'kind', 'published_artifact_sections'), s = raw, inherited = kind.kind === 'data' && kind.value === 'inherited';
        if (!ownDataObjectHasOwn(s, 'obligationId') || !ownDataObjectHasOwn(s, 'artifacts') || inherited && (!ownDataObjectHasOwn(s, 'originOwner') || !ownDataObjectHasOwn(s, 'originalObligationId')))
            throw Error('published_artifact_sections');
        const origin = inherited ? s.originOwner : payloadOwner;
        assertPublishedArtifactOwner(origin);
        const artifacts = s.artifacts;
        if (!ownDataArrayIsArray(artifacts) || artifacts.length > 4096)
            throw Error('published_artifact_limit');
        for (const rawArtifact of capturedArrayIterator(artifacts)) {
            if (!rawArtifact || typeof rawArtifact !== 'object' || ownDataArrayIsArray(rawArtifact))
                throw Error('published_artifact_shape');
            if (ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(rawArtifact)), ',') !== 'bytesBase64,path,sha256,size')
                throw Error('published_artifact_shape');
            encodedArtifactBytes += ownDataBufferByteLength(json(rawArtifact));
            if (encodedArtifactBytes > 32 * 1024 ** 2)
                throw Error('published_artifact_limit');
            value.count++;
            value.selectionBytes += ownDataBufferByteLength(json({ kind: inherited ? 'inherited' : 'local', obligationId: s.obligationId, path: rawArtifact.path, ...(inherited ? { originOwner: origin, originalObligationId: s.originalObligationId } : {}) }));
            const k = key(inherited ? 'inherited' : 'local', origin, s.obligationId, inherited ? s.originalObligationId : null, rawArtifact.path);
            if (!apply(setHas, selectedKeys, [k]))
                continue;
            const list = ownDataMapPrototypeGet(value.entries, k);
            if (list && list.length === 2)
                continue; // Two witnesses suffice to reject ambiguity.
            const entry = ownDataObjectFreeze({ path: rawArtifact.path, sha256: rawArtifact.sha256, size: rawArtifact.size, bytesBase64: rawArtifact.bytesBase64 });
            if (list)
                append(list, entry);
            else
                ownDataMapPrototypeSet(value.entries, k, [entry]);
            ownDataSetPrototypeAdd(value.records, entry);
        }
    }
    const token = ownDataObjectFreeze({});
    ownDataWeakMapPrototypeSet(indexes, token, value);
    return token;
}
export function publishedArtifactPopulation(index) { const value = data(index); return ownDataObjectFreeze({ count: value.count, selectionBytes: value.selectionBytes }); }
export function assertPublishedArtifactIndexOwner(index, owner) {
    assertPublishedArtifactOwner(owner);
    if (data(index).ownerKey !== json(owner))
        throw Error('published_artifact_index_owner');
}
export function publishedArtifactLookupKeys(applicationOwner, selection, allowLocalInheritance = false) {
    assertPublishedArtifactOwner(applicationOwner);
    assertPublishedArtifactSelection(selection);
    const origin = selection.kind === 'local' ? applicationOwner : selection.originOwner;
    const keys = [key(selection.kind, origin, selection.obligationId, selection.kind === 'inherited' ? selection.originalObligationId : null, selection.path)];
    if (allowLocalInheritance && selection.kind === 'local')
        ownDataArrayPrototypePush(keys, key('inherited', origin, selection.obligationId, selection.obligationId, selection.path));
    return keys;
}
export function findIndexedPublishedArtifacts(index, applicationOwner, selection, allowLocalInheritance = false) {
    const value = data(index);
    return ownDataObjectFreeze(ownDataArrayPrototypeFlatMap(publishedArtifactLookupKeys(applicationOwner, selection, allowLocalInheritance), k => ownDataMapPrototypeGet(value.entries, k) ?? []));
}
function decoded(index, entry) {
    const value = data(index);
    if (!ownDataSetPrototypeHas(value.records, entry))
        throw Error('published_artifact_content_index');
    const previous = ownDataWeakMapPrototypeGet(value.decoded, entry);
    if (previous)
        return previous;
    const { size, sha256, bytesBase64 } = entry;
    if (typeof size !== 'number' || !ownDataNumberIsSafeInteger(size) || size < 0 || size > 16 * 1024 ** 2 || typeof sha256 !== 'string' || typeof bytesBase64 !== 'string' || bytesBase64.length !== 4 * ownDataMathCeil(size / 3))
        throw Error('published_artifact_content');
    const bytes = ownDataBufferFrom(bytesBase64, 'base64');
    if (bytes.length !== size || ownDataBufferPrototypeToString(bytes, 'base64') !== bytesBase64 || ownDataHashPrototypeDigest(ownDataHashPrototypeUpdate(ownDataCryptoCreateHash('sha256'), bytes), 'hex') !== sha256)
        throw Error('published_artifact_content');
    ownDataWeakMapPrototypeSet(value.decoded, entry, bytes);
    return bytes;
}
export function verifyIndexedPublishedArtifact(index, entry) { decoded(index, entry); }
export function readIndexedPublishedArtifact(index, entry) { return ownDataBufferFrom(decoded(index, entry)); }
