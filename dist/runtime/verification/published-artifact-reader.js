import { types } from 'node:util';
import { createPublishedArtifactIndex, publishedArtifactLookupKeys, findIndexedPublishedArtifacts, readIndexedPublishedArtifact } from './published-artifact-index.js';
import { assertIndexedIntentApplicationArtifacts } from './intent-application-artifacts.js';
import { createHash } from 'node:crypto';
import { parseActiveBusinessApplicationBinding, parseBusinessApplicationBinding, businessApplicationOwner } from './business-application-binding.js';
import { assertIndexedLoopApplicationArtifacts } from './loop-application-artifacts.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { parsePublishedArtifactSelection, assertPublishedArtifactOwner as owner, assertPublishedArtifactPath as logicalPath } from './published-artifact-selection.js';
import { applicationDataDescriptors, readApplicationOwnDataField } from './application-value-data.js';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ownKeys = Reflect.ownKeys, getOwn = Object.getOwnPropertyDescriptor, hasOwn = Object.hasOwn, reflectGet = Reflect.get, defineData = Object.defineProperty;
function descriptorData(value, key, error) { const d = getOwn(value, key); if (!d || !hasOwn(d, 'value'))
    throw Error(error); return reflectGet(d, 'value', d); }
function descriptorMapData(value, key, error) { const wrapper = getOwn(value, key); if (!wrapper || !hasOwn(wrapper, 'value'))
    throw Error(error); const descriptor = reflectGet(wrapper, 'value', wrapper); if (!descriptor || typeof descriptor !== 'object' || !hasOwn(descriptor, 'value'))
    throw Error(error); return reflectGet(descriptor, 'value', descriptor); }
function append(target, value) { defineData(target, `${target.length}`, { value, enumerable: true, writable: true, configurable: true }); }
const PUBLISHED_PAYLOAD_FIELDS = ['businessRevision', 'bytes', 'fullTupleHash', 'operationId', 'owner', 'payloadHash'];
function fields(value, keys) { if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
    throw Error('published_artifact_shape'); }
function identifier(value) { if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
    throw Error('published_artifact_identity'); }
function digest(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw Error('published_artifact_hash'); }
/** Content decoder only. A copied DTO or returned descriptor is never proof of
 * current verification and never authorizes a completion/store mutation.
 * No filesystem paths are resolved or opened. */
export function readPublishedArtifact(payload, rawSelection) { return readPublishedArtifacts(payload, [rawSelection])[0]; }
/** One bounded payload parse/index shared by all selected content and application checks. */
export function readPublishedArtifacts(payload, rawSelections, expectedRootBinding) {
    const payloadDescriptors = applicationDataDescriptors(payload, PUBLISHED_PAYLOAD_FIELDS.length, 'published_artifact_payload'), payloadKeys = ownKeys(payloadDescriptors);
    if (payloadKeys.length !== PUBLISHED_PAYLOAD_FIELDS.length)
        throw Error('published_artifact_payload');
    for (let i = 0; i < payloadKeys.length; i++) {
        const key = payloadKeys[i];
        if (typeof key !== 'string' || !PUBLISHED_PAYLOAD_FIELDS.includes(key))
            throw Error('published_artifact_payload');
    }
    const source = descriptorMapData(payloadDescriptors, 'bytes', 'published_artifact_payload');
    if (!Buffer.isBuffer(source) || source.length < 1 || source.length > 32 * 1024 ** 2)
        throw Error('published_artifact_limit');
    const bytes = Buffer.from(source);
    const ownerValue = descriptorMapData(payloadDescriptors, 'owner', 'published_artifact_payload'), businessRevision = descriptorMapData(payloadDescriptors, 'businessRevision', 'published_artifact_payload'), operationId = descriptorMapData(payloadDescriptors, 'operationId', 'published_artifact_payload'), fullTupleHash = descriptorMapData(payloadDescriptors, 'fullTupleHash', 'published_artifact_payload'), payloadHash = descriptorMapData(payloadDescriptors, 'payloadHash', 'published_artifact_payload');
    owner(ownerValue);
    identifier(operationId);
    digest(fullTupleHash);
    digest(payloadHash);
    if (!Number.isSafeInteger(businessRevision) || businessRevision < 1)
        throw Error('published_artifact_payload');
    const identity = JSON.parse(json({ owner: ownerValue, businessRevision, operationId, fullTupleHash, payloadHash }));
    owner(identity.owner);
    identifier(identity.operationId);
    digest(identity.fullTupleHash);
    digest(identity.payloadHash);
    if (hash(bytes) !== identity.payloadHash)
        throw Error('published_artifact_payload');
    let body;
    try {
        body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    catch {
        throw Error('published_artifact_encoding');
    }
    fields(body, ['version', 'owner', 'dependencies', 'evaluations', ...(Object.hasOwn(body ?? {}, 'application') ? ['application'] : [])]);
    owner(body.owner);
    if (body.version !== 1 || json(body.owner) !== json(identity.owner) || !Array.isArray(body.dependencies) || body.dependencies.length > 256 || !Array.isArray(body.evaluations) || body.evaluations.length > 256 || !Buffer.from(json(body)).equals(bytes))
        throw Error('published_artifact_payload');
    if (expectedRootBinding !== undefined) {
        let expected;
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
    const applicationChecks = [];
    if (Object.hasOwn(body, 'application'))
        applicationChecks.push({ origin: body.owner, raw: body.application });
    for (const section of body.evaluations) {
        const sectionKind = section && typeof section === 'object' ? readApplicationOwnDataField(section, 'kind', 'published_artifact_shape') : null;
        const inherited = sectionKind?.kind === 'data' && sectionKind.value === 'inherited';
        fields(section, ['obligationId', 'definitionHash', 'binding', 'evaluation', 'artifacts', ...(inherited ? ['kind', 'originOwner', 'originalObligationId'] : []), ...(Object.hasOwn(section ?? {}, 'application') ? ['application'] : [])]);
        identifier(section.obligationId);
        digest(section.definitionHash);
        if (inherited) {
            owner(section.originOwner);
            identifier(section.originalObligationId);
        }
        if (Object.hasOwn(section, 'application'))
            applicationChecks.push({ origin: inherited ? section.originOwner : body.owner, raw: section.application });
        if (!inherited && json(section.application ?? null) !== json(body.application ?? null))
            throw Error('published_artifact_application');
        if (!Array.isArray(section.artifacts) || section.artifacts.length > 4096)
            throw Error('published_artifact_limit');
        for (const artifact of section.artifacts) {
            artifactCount++;
            availableSelectionBytes += Buffer.byteLength(json({ kind: inherited ? 'inherited' : 'local', obligationId: section.obligationId, path: artifact.path, ...(inherited ? { originOwner: section.originOwner, originalObligationId: section.originalObligationId } : {}) }));
            fields(artifact, ['path', 'sha256', 'size', 'bytesBase64']);
            logicalPath(artifact.path);
            digest(artifact.sha256);
            if (!Number.isSafeInteger(artifact.size) || artifact.size < 0 || artifact.size > 16 * 1024 ** 2 || typeof artifact.bytesBase64 !== 'string' || artifact.bytesBase64.length !== 4 * Math.ceil(artifact.size / 3))
                throw Error('published_artifact_size');
        }
    }
    if (types.isProxy(rawSelections) || !Array.isArray(rawSelections))
        throw Error('published_artifact_selection_limit');
    const selectionCount = descriptorData(rawSelections, 'length', 'published_artifact_selection_limit');
    if (!Number.isSafeInteger(selectionCount) || selectionCount > artifactCount)
        throw Error('published_artifact_selection_limit');
    applicationDataDescriptors(rawSelections, selectionCount + 1, 'published_artifact_selection');
    const selectionKeys = ownKeys(rawSelections);
    if (selectionKeys.length !== selectionCount + 1 || selectionKeys.some(key => typeof key !== 'string' || key !== 'length' && !(/^(?:0|[1-9][0-9]*)$/.test(key) && Number(key) < selectionCount)))
        throw Error('published_artifact_selection');
    const selections = [], seen = new Set();
    let selectionBytes = 0;
    for (let i = 0; i < selectionCount; i++) {
        const raw = descriptorData(rawSelections, String(i), 'published_artifact_selection');
        preflightSelection(raw);
        const selection = parsePublishedArtifactSelection(raw), encoded = json(selection);
        if (seen.has(encoded))
            throw Error('published_artifact_selection_duplicate');
        seen.add(encoded);
        selectionBytes += Buffer.byteLength(encoded);
        if (selectionBytes > availableSelectionBytes)
            throw Error('published_artifact_selection_limit');
        append(selections, selection);
    }
    const keys = new Set();
    for (const selection of selections)
        for (const key of publishedArtifactLookupKeys(body.owner, selection))
            keys.add(key);
    const applications = applicationChecks.map(check => {
        const active = parseActiveBusinessApplicationBinding(check.raw);
        if (json({ ownerKind: check.origin.ownerKind, ownerId: check.origin.ownerId }) !== json(businessApplicationOwner(active.binding)))
            throw Error('published_artifact_application');
        if (active.binding.kind === 'loop' || active.binding.kind === 'intent')
            for (const artifact of active.binding.body.artifacts)
                for (const key of publishedArtifactLookupKeys(check.origin, artifact.selection, true))
                    keys.add(key);
        return { ...check, active };
    });
    const index = createPublishedArtifactIndex(body.owner, body.evaluations, keys);
    for (const { origin, active } of applications) {
        if (active.binding.kind === 'loop')
            assertIndexedLoopApplicationArtifacts(origin, active.binding, body.owner, index);
        if (active.binding.kind === 'intent')
            assertIndexedIntentApplicationArtifacts(origin, active.binding, body.owner, index);
    }
    const result = selections.map(selection => {
        const matches = findIndexedPublishedArtifacts(index, body.owner, selection);
        if (matches.length !== 1)
            throw Error('published_artifact_not_unique');
        const selected = matches[0], content = readIndexedPublishedArtifact(index, selected);
        return Object.freeze({ ...identity, owner: Object.freeze(identity.owner), selection, path: selected.path, sha256: selected.sha256, size: selected.size, bytes: content });
    });
    return Object.freeze(result);
}
function preflightSelection(raw) {
    if (!raw || typeof raw !== 'object' || types.isProxy(raw) || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
        throw Error('published_artifact_selection');
    const kind = readApplicationOwnDataField(raw, 'kind', 'published_artifact_selection');
    if (kind.kind !== 'data' || !['local', 'inherited'].includes(kind.value))
        throw Error('published_artifact_selection');
    const allowed = kind.value === 'local' ? ['kind', 'obligationId', 'path'] : ['kind', 'obligationId', 'path', 'originOwner', 'originalObligationId'];
    const descriptors = applicationDataDescriptors(raw, allowed.length, 'published_artifact_selection'), keys = Reflect.ownKeys(descriptors);
    let count = 0;
    for (const key of keys) {
        if (typeof key !== 'string')
            throw Error('published_artifact_selection');
        const k = key;
        if (k.length > 20 || !allowed.includes(k) || ++count > allowed.length)
            throw Error('published_artifact_selection');
        const field = readApplicationOwnDataField(raw, k, 'published_artifact_selection');
        if (field.kind !== 'data')
            throw Error('published_artifact_selection');
        const value = field.value;
        if (k === 'originOwner') {
            if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
                throw Error('published_artifact_selection');
            const ownerDescriptors = applicationDataDescriptors(value, 3, 'published_artifact_selection');
            let fields = 0;
            for (const ownerKey of Reflect.ownKeys(ownerDescriptors)) {
                if (typeof ownerKey !== 'string')
                    throw Error('published_artifact_selection');
                const fieldName = ownerKey;
                if (fieldName.length > 10 || !['profileId', 'ownerKind', 'ownerId'].includes(fieldName) || ++fields > 3)
                    throw Error('published_artifact_selection');
                const member = readApplicationOwnDataField(value, fieldName, 'published_artifact_selection');
                if (member.kind !== 'data' || typeof member.value !== 'string' || Buffer.byteLength(member.value) > 160)
                    throw Error('published_artifact_selection');
            }
        }
        else if (typeof value !== 'string' || (k === 'path' ? value.length > 4096 : Buffer.byteLength(value) > 160))
            throw Error('published_artifact_selection');
    }
    if (Object.getOwnPropertySymbols(raw).length)
        throw Error('published_artifact_selection');
}
