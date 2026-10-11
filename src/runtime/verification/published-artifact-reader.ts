import {ownDataMathCeil,ownDataArrayIsArray,ownDataArrayPrototypeIncludes,ownDataArrayPrototypeJoin,ownDataArrayPrototypeSort,ownDataBufferByteLength,ownDataBufferFrom,ownDataBufferIsBuffer,ownDataBufferPrototypeEquals,ownDataCryptoCreateHash,ownDataHashPrototypeDigest,ownDataHashPrototypeUpdate,ownDataJSONParse,ownDataNumber,ownDataNumberIsSafeInteger,ownDataObjectFreeze,ownDataObjectGetOwnPropertySymbols,ownDataObjectGetPrototypeOf,ownDataObjectHasOwn,ownDataObjectKeys,ownDataReflectOwnKeys,ownDataRegExpPrototypeTest,ownDataString,ownDataTextDecoder,ownDataTextDecoderPrototypeDecode,ownDataUtilTypesIsProxy} from './application-native-intrinsics.js';
import { capturedArrayIterator, capturedArrayMap, capturedSetAdd, capturedSetHas, createCapturedSet } from './application-iteration-intrinsics.js';
import { types } from 'node:util';
import { createPublishedArtifactIndex, publishedArtifactLookupKeys, findIndexedPublishedArtifacts, readIndexedPublishedArtifact } from './published-artifact-index.js';
import { assertIndexedIntentApplicationArtifacts } from './intent-application-artifacts.js';
import { createHash } from 'node:crypto';
import type { PublishedPayload } from './publication-client.js';
import type { VerificationOwner } from './proof-authority.js';
import { parseActiveBusinessApplicationBinding, parseBusinessApplicationBinding, businessApplicationOwner, type BusinessApplicationBinding } from './business-application-binding.js';
import { assertIndexedLoopApplicationArtifacts } from './loop-application-artifacts.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { parsePublishedArtifactSelection, assertPublishedArtifactOwner as owner, assertPublishedArtifactPath as logicalPath, type PublishedArtifactSelection } from './published-artifact-selection.js';
import { applicationDataDescriptors, readApplicationOwnDataField } from './application-value-data.js';
export type { PublishedArtifactSelection } from './published-artifact-selection.js';
const hash = (bytes: Buffer) => ownDataHashPrototypeDigest(ownDataHashPrototypeUpdate(ownDataCryptoCreateHash('sha256'), bytes), 'hex');
const ownKeys = Reflect.ownKeys, getOwn = Object.getOwnPropertyDescriptor, hasOwn = Object.hasOwn, reflectGet = Reflect.get, defineData = Object.defineProperty;
function descriptorData(value: object, key: PropertyKey, error: string) { const d = getOwn(value, key); if (!d || !hasOwn(d, 'value'))
    throw Error(error); return reflectGet(d, 'value', d); }
function descriptorMapData(value: PropertyDescriptorMap, key: string, error: string) { const wrapper = getOwn(value, key); if (!wrapper || !hasOwn(wrapper, 'value'))
    throw Error(error); const descriptor = reflectGet(wrapper, 'value', wrapper); if (!descriptor || typeof descriptor !== 'object' || !hasOwn(descriptor, 'value'))
    throw Error(error); return reflectGet(descriptor, 'value', descriptor); }
function append<T>(target: T[], value: T) { defineData(target, `${target.length}`, ({ __proto__: null, value, enumerable: true, writable: true, configurable: true } as PropertyDescriptor)); }
function includes(values: readonly string[], candidate: string): boolean { for (const value of capturedArrayIterator(values))
    if (value === candidate)
        return true; return false; }
const PUBLISHED_PAYLOAD_FIELDS = ['businessRevision', 'bytes', 'fullTupleHash', 'operationId', 'owner', 'payloadHash'] as const;
function fields<T>(value: T, keys: string[]): asserts value is T & Record<string, unknown> { if (!value || typeof value !== 'object' || ownDataUtilTypesIsProxy(value) || ownDataArrayIsArray(value) || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(value)), ',') !== ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(keys), ','))
    throw Error('published_artifact_shape'); }
function identifier(value: unknown): asserts value is string { if (typeof value !== 'string' || !value || ownDataBufferByteLength(value) > 160 || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, value))
    throw Error('published_artifact_identity'); }
function digest(value: unknown): asserts value is string { if (typeof value !== 'string' || !ownDataRegExpPrototypeTest(/^[a-f0-9]{64}$/, value))
    throw Error('published_artifact_hash'); }
/** Content decoder only. A copied DTO or returned descriptor is never proof of
 * current verification and never authorizes a completion/store mutation.
 * No filesystem paths are resolved or opened. */
export function readPublishedArtifact(payload: Readonly<PublishedPayload>, rawSelection: PublishedArtifactSelection) { return readPublishedArtifacts(payload, [rawSelection])[0]; }
/** One bounded payload parse/index shared by all selected content and application checks. */
export function readPublishedArtifacts(payload: Readonly<PublishedPayload>, rawSelections: readonly PublishedArtifactSelection[], expectedRootBinding?: Readonly<BusinessApplicationBinding>) {
    const payloadDescriptors = applicationDataDescriptors(payload, PUBLISHED_PAYLOAD_FIELDS.length, 'published_artifact_payload'), payloadKeys = ownKeys(payloadDescriptors);
    if (payloadKeys.length !== PUBLISHED_PAYLOAD_FIELDS.length)
        throw Error('published_artifact_payload');
    for (let i = 0; i < payloadKeys.length; i++) {
        const key = payloadKeys[i];
        if (typeof key !== 'string' || !includes(PUBLISHED_PAYLOAD_FIELDS, key))
            throw Error('published_artifact_payload');
    }
    const source = descriptorMapData(payloadDescriptors, 'bytes', 'published_artifact_payload');
    if (!ownDataBufferIsBuffer(source) || source.length < 1 || source.length > 32 * 1024 ** 2)
        throw Error('published_artifact_limit');
    const bytes = ownDataBufferFrom(source);
    const ownerValue = descriptorMapData(payloadDescriptors, 'owner', 'published_artifact_payload'), businessRevision = descriptorMapData(payloadDescriptors, 'businessRevision', 'published_artifact_payload'), operationId = descriptorMapData(payloadDescriptors, 'operationId', 'published_artifact_payload'), fullTupleHash = descriptorMapData(payloadDescriptors, 'fullTupleHash', 'published_artifact_payload'), payloadHash = descriptorMapData(payloadDescriptors, 'payloadHash', 'published_artifact_payload');
    owner(ownerValue);
    identifier(operationId);
    digest(fullTupleHash);
    digest(payloadHash);
    if (!ownDataNumberIsSafeInteger(businessRevision) || businessRevision < 1)
        throw Error('published_artifact_payload');
    const identity = ownDataJSONParse(json({ owner: ownerValue, businessRevision, operationId, fullTupleHash, payloadHash }));
    owner(identity.owner);
    identifier(identity.operationId);
    digest(identity.fullTupleHash);
    digest(identity.payloadHash);
    if (hash(bytes) !== identity.payloadHash)
        throw Error('published_artifact_payload');
    let body: any;
    try {
        body = ownDataJSONParse(ownDataTextDecoderPrototypeDecode(ownDataTextDecoder('utf-8'), bytes));
    }
    catch {
        throw Error('published_artifact_encoding');
    }
    const bodyFields = ['version', 'owner', 'dependencies', 'evaluations'];
    if (ownDataObjectHasOwn(body ?? {}, 'application'))
        append(bodyFields, 'application');
    fields(body, bodyFields);
    owner(body.owner);
    if (body.version !== 1 || json(body.owner) !== json(identity.owner) || !ownDataArrayIsArray(body.dependencies) || body.dependencies.length > 256 || !ownDataArrayIsArray(body.evaluations) || body.evaluations.length > 256 || !ownDataBufferPrototypeEquals(ownDataBufferFrom(json(body)), bytes))
        throw Error('published_artifact_payload');
    if (expectedRootBinding !== undefined) {
        let expected: string;
        try {
            expected = json(parseBusinessApplicationBinding(expectedRootBinding));
        }
        catch {
            throw Error('published_artifact_application');
        }
        if (json(body.application?.binding ?? null) !== expected)
            throw Error('published_artifact_application');
    }
    let artifactCount = 0, availableSelectionBytes = 0;
    const applicationChecks: {
        origin: Readonly<VerificationOwner>;
        raw: unknown;
    }[] = [];
    if (ownDataObjectHasOwn(body, 'application'))
        append(applicationChecks, { origin: body.owner, raw: body.application });
    for (const section of capturedArrayIterator(body.evaluations)) {
        const sectionKind = section && typeof section === 'object' ? readApplicationOwnDataField(section, 'kind', 'published_artifact_shape') : null;
        const inherited = sectionKind?.kind === 'data' && sectionKind.value === 'inherited', sectionFields = ['obligationId', 'definitionHash', 'binding', 'evaluation', 'artifacts'];
        if (inherited) {
            append(sectionFields, 'kind');
            append(sectionFields, 'originOwner');
            append(sectionFields, 'originalObligationId');
        }
        if (ownDataObjectHasOwn(section ?? {}, 'application'))
            append(sectionFields, 'application');
        fields(section, sectionFields);
        identifier(section.obligationId);
        digest(section.definitionHash);
        if (inherited) {
            owner(section.originOwner);
            identifier(section.originalObligationId);
        }
        if (ownDataObjectHasOwn(section, 'application'))
            append(applicationChecks, { origin: inherited ? section.originOwner : body.owner, raw: section.application });
        if (!inherited && json(section.application ?? null) !== json(body.application ?? null))
            throw Error('published_artifact_application');
        if (!ownDataArrayIsArray(section.artifacts) || section.artifacts.length > 4096)
            throw Error('published_artifact_limit');
        for (const artifact of capturedArrayIterator(section.artifacts)) {
            artifactCount++;
            if (!artifact || typeof artifact !== 'object' || ownDataArrayIsArray(artifact))
                throw Error('published_artifact_shape');
            fields(artifact, ['path', 'sha256', 'size', 'bytesBase64']);
            logicalPath(artifact.path);
            digest(artifact.sha256);
            if (!ownDataNumberIsSafeInteger(artifact.size) || (artifact.size as number) < 0 || (artifact.size as number) > 16 * 1024 ** 2 || typeof artifact.bytesBase64 !== 'string' || artifact.bytesBase64.length !== 4 * ownDataMathCeil((artifact.size as number) / 3))
                throw Error('published_artifact_size');
            availableSelectionBytes += ownDataBufferByteLength(json({ kind: inherited ? 'inherited' : 'local', obligationId: section.obligationId, path: artifact.path, ...(inherited ? { originOwner: section.originOwner, originalObligationId: section.originalObligationId } : {}) }));
        }
    }
    if (ownDataUtilTypesIsProxy(rawSelections) || !ownDataArrayIsArray(rawSelections))
        throw Error('published_artifact_selection_limit');
    const selectionCount = descriptorData(rawSelections, 'length', 'published_artifact_selection_limit');
    if (!ownDataNumberIsSafeInteger(selectionCount) || selectionCount > artifactCount)
        throw Error('published_artifact_selection_limit');
    applicationDataDescriptors(rawSelections, selectionCount + 1, 'published_artifact_selection');
    const selectionKeys = ownKeys(rawSelections);
    let invalidSelectionKey = selectionKeys.length !== selectionCount + 1;
    for (const key of capturedArrayIterator(selectionKeys))
        if (typeof key !== 'string' || key !== 'length' && !(ownDataRegExpPrototypeTest(/^(?:0|[1-9][0-9]*)$/, key) && ownDataNumber(key) < selectionCount))
            invalidSelectionKey = true;
    if (invalidSelectionKey)
        throw Error('published_artifact_selection');
    const selections: Readonly<PublishedArtifactSelection>[] = [], seen = createCapturedSet<string>();
    let selectionBytes = 0;
    for (let i = 0; i < selectionCount; i++) {
        const raw = descriptorData(rawSelections, ownDataString(i), 'published_artifact_selection');
        preflightSelection(raw);
        const selection = parsePublishedArtifactSelection(raw), encoded = json(selection);
        if (capturedSetHas(seen, encoded))
            throw Error('published_artifact_selection_duplicate');
        capturedSetAdd(seen, encoded);
        selectionBytes += ownDataBufferByteLength(encoded);
        if (selectionBytes > availableSelectionBytes)
            throw Error('published_artifact_selection_limit');
        append(selections, selection);
    }
    const keys = createCapturedSet<string>();
    for (const selection of capturedArrayIterator(selections))
        for (const key of capturedArrayIterator(publishedArtifactLookupKeys(body.owner, selection)))
            capturedSetAdd(keys, key);
    const applications = capturedArrayMap(applicationChecks, check => {
        const active = parseActiveBusinessApplicationBinding(check.raw);
        if (json({ ownerKind: check.origin.ownerKind, ownerId: check.origin.ownerId }) !== json(businessApplicationOwner(active.binding)))
            throw Error('published_artifact_application');
        if (active.binding.kind === 'loop' || active.binding.kind === 'intent')
            for (const artifact of capturedArrayIterator(active.binding.body.artifacts))
                for (const key of capturedArrayIterator(publishedArtifactLookupKeys(check.origin, artifact.selection, true)))
                    capturedSetAdd(keys, key);
        return { ...check, active };
    });
    const index = createPublishedArtifactIndex(body.owner, body.evaluations, keys);
    for (const { origin, active } of capturedArrayIterator(applications)) {
        if (active.binding.kind === 'loop')
            assertIndexedLoopApplicationArtifacts(origin, active.binding, body.owner, index);
        if (active.binding.kind === 'intent')
            assertIndexedIntentApplicationArtifacts(origin, active.binding, body.owner, index);
    }
    const result = capturedArrayMap(selections, selection => {
        const matches = findIndexedPublishedArtifacts(index, body.owner, selection);
        if (matches.length !== 1)
            throw Error('published_artifact_not_unique');
        const selected = matches[0], content = readIndexedPublishedArtifact(index, selected);
        return ownDataObjectFreeze({ ...identity, owner: ownDataObjectFreeze(identity.owner) as Readonly<VerificationOwner>, selection, path: selected.path as string, sha256: selected.sha256 as string, size: selected.size as number, bytes: content });
    });
    return ownDataObjectFreeze(result);
}
function preflightSelection(raw: unknown): void {
    if (!raw || typeof raw !== 'object' || ownDataUtilTypesIsProxy(raw) || ownDataArrayIsArray(raw) || !ownDataArrayPrototypeIncludes([Object.prototype, null], ownDataObjectGetPrototypeOf(raw)))
        throw Error('published_artifact_selection');
    const kind = readApplicationOwnDataField(raw, 'kind', 'published_artifact_selection');
    if (kind.kind !== 'data' || !ownDataArrayPrototypeIncludes(['local', 'inherited'], kind.value as string))
        throw Error('published_artifact_selection');
    const allowed = kind.value === 'local' ? ['kind', 'obligationId', 'path'] : ['kind', 'obligationId', 'path', 'originOwner', 'originalObligationId'];
    const descriptors = applicationDataDescriptors(raw, allowed.length, 'published_artifact_selection'), keys = ownDataReflectOwnKeys(descriptors);
    let count = 0;
    for (const key of capturedArrayIterator(keys)) {
        if (typeof key !== 'string')
            throw Error('published_artifact_selection');
        const k = key;
        if (k.length > 20 || !ownDataArrayPrototypeIncludes(allowed, k) || ++count > allowed.length)
            throw Error('published_artifact_selection');
        const field = readApplicationOwnDataField(raw, k, 'published_artifact_selection');
        if (field.kind !== 'data')
            throw Error('published_artifact_selection');
        const value = field.value;
        if (k === 'originOwner') {
            if (!value || typeof value !== 'object' || ownDataUtilTypesIsProxy(value) || ownDataArrayIsArray(value) || !ownDataArrayPrototypeIncludes([Object.prototype, null], ownDataObjectGetPrototypeOf(value)))
                throw Error('published_artifact_selection');
            const ownerDescriptors = applicationDataDescriptors(value, 3, 'published_artifact_selection');
            let fields = 0;
            for (const ownerKey of capturedArrayIterator(ownDataReflectOwnKeys(ownerDescriptors))) {
                if (typeof ownerKey !== 'string')
                    throw Error('published_artifact_selection');
                const fieldName = ownerKey;
                if (fieldName.length > 10 || !ownDataArrayPrototypeIncludes(['profileId', 'ownerKind', 'ownerId'], fieldName) || ++fields > 3)
                    throw Error('published_artifact_selection');
                const member = readApplicationOwnDataField(value, fieldName, 'published_artifact_selection');
                if (member.kind !== 'data' || typeof member.value !== 'string' || ownDataBufferByteLength(member.value) > 160)
                    throw Error('published_artifact_selection');
            }
        }
        else if (typeof value !== 'string' || (k === 'path' ? value.length > 4096 : ownDataBufferByteLength(value) > 160))
            throw Error('published_artifact_selection');
    }
    if (ownDataObjectGetOwnPropertySymbols(raw).length)
        throw Error('published_artifact_selection');
}
