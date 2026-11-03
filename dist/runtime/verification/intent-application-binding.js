import { ownDataArrayIsArray, ownDataArrayPrototypeForEach, ownDataArrayPrototypeIncludes, ownDataArrayPrototypeJoin, ownDataArrayPrototypeSort, ownDataBufferByteLength, ownDataBufferFrom, ownDataBufferPrototypeToString, ownDataCryptoCreateHash, ownDataHashPrototypeDigest, ownDataHashPrototypeUpdate, ownDataMapPrototypeGet, ownDataMapPrototypeSet, ownDataMathMin, ownDataNumberIsSafeInteger, ownDataObjectFreeze, ownDataObjectHasOwn, ownDataObjectKeys, ownDataObjectValues, ownDataReflectGet, ownDataReflectOwnKeys, ownDataRegExpPrototypeTest, ownDataSetPrototypeAdd, ownDataSetPrototypeHas, ownDataSetPrototypeSizeGetter, ownDataStringPrototypeSplit } from './application-native-intrinsics.js';
import { capturedArrayFilter, capturedArrayFind, capturedArrayIterator, capturedArrayMap, capturedArraySome, capturedMapValuesIterator, createCapturedMap, createCapturedSet, setFromDenseArray } from './application-iteration-intrinsics.js';
import { applicationDataDescriptors, applicationDataFromEntries, captureApplicationData, readApplicationOwnDataField } from './application-value-data.js';
import { VERIFICATION_BUDGET } from './protocol.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { parseIntentHostSubject } from './intent-host-subject.js';
import { parseIntentBusinessContract, INTENT_BUSINESS_CONTRACT_HASH_DOMAIN } from './intent-business-contract.js';
import { parsePublishedArtifactSelection } from './published-artifact-selection.js';
import { parseIntentProducerReport } from '../intent-delegation/producer-report.js';
const coreFields = 'version kind subject candidateId candidateRevision contract body';
const defineData = Object.defineProperty;
function fields(raw, names) {
    if (!raw || typeof raw !== 'object' || ownDataArrayIsArray(raw) || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(raw)), ',') !== ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataStringPrototypeSplit(names, ' ')), ','))
        throw Error('intent_application_shape');
}
function id(raw) {
    if (typeof raw !== 'string' || !raw || ownDataBufferByteLength(raw) > 160 || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, raw))
        throw Error('intent_application_identity');
}
function integer(raw, min = 0) {
    if (!ownDataNumberIsSafeInteger(raw) || raw < min)
        throw Error('intent_application_number');
}
function text(raw) {
    if (typeof raw !== 'string')
        throw Error('intent_application_text');
}
function digest(raw) {
    if (typeof raw !== 'string' || !ownDataRegExpPrototypeTest(/^[a-f0-9]{64}$/, raw))
        throw Error('intent_application_hash');
}
function hash(domain, raw) { return ownDataHashPrototypeDigest(ownDataHashPrototypeUpdate(ownDataHashPrototypeUpdate(ownDataCryptoCreateHash('sha256'), domain + '\0'), json(raw)), 'hex'); }
function freeze(value) {
    if (value && typeof value === 'object') {
        ownDataArrayPrototypeForEach(ownDataObjectValues(value), freeze);
        ownDataObjectFreeze(value);
    }
    return value;
}
const dataDescriptors = (value, maximumKeys = 65536) => applicationDataDescriptors(value, maximumKeys, 'intent_application_data');
const copyData = (raw, maximumBytes, maximumNodes, invalid = 'intent_application_data') => captureApplicationData(raw, { maximumBytes, maximumNodes, invalid, limit: 'intent_application_limit' });
const ownDescriptorValue = (descriptors, key) => { const descriptor = descriptors[key]; return descriptor && ownDataObjectHasOwn(descriptor, 'value') ? ownDataReflectGet(descriptor, 'value', descriptor) : undefined; };
function append(target, value) { defineData(target, `${target.length}`, { __proto__: null, value, enumerable: true, writable: true, configurable: true }); }
function parentByteLimit(stages) { return ownDataMathMin(VERIFICATION_BUDGET.controlDatabaseBytes, 131084 + stages * (6 * 65536 + 4096)); }
// Only two fresh private trees returned by captureApplicationData enter this comparator.
// All reads are own keys; no caller reference, callback, iterator, metadata or authority.
function samePrivateContractData(left, right) {
    if (left === right && (left !== 0 || 1 / left === 1 / right))
        return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || ownDataArrayIsArray(left) !== ownDataArrayIsArray(right))
        return false;
    const leftKeys = ownDataObjectKeys(left), rightKeys = ownDataObjectKeys(right);
    if (leftKeys.length !== rightKeys.length)
        return false;
    for (let index = 0; index < leftKeys.length; index++) {
        const key = leftKeys[index];
        if (key !== rightKeys[index] || !ownDataObjectHasOwn(right, key) || !samePrivateContractData(ownDataReflectGet(left, key, left), ownDataReflectGet(right, key, right)))
            return false;
    }
    return true;
}
/** Data snapshot only: it cannot establish that a producer, native approval or receiver ran. */
function capture(raw) {
    const descriptors = dataDescriptors(raw);
    const privateContractInput = copyData(ownDescriptorValue(descriptors, 'contract'), 65536, 65536);
    const contract = parseIntentBusinessContract(privateContractInput);
    const bodyRaw = ownDescriptorValue(descriptors, 'body'), body = dataDescriptors(bodyRaw), bodyKind = readApplicationOwnDataField(bodyRaw, 'kind', 'intent_application_body'), parent = bodyKind.kind === 'data' && bodyKind.value === 'intent-parent', stages = contract.stages.length;
    if (bodyKind.kind === 'missing')
        throw Error('intent_application_body');
    const result = copyData(raw, parent ? parentByteLimit(stages) : 131084, parent ? (stages + 2) * 65536 : 65536);
    bounded(result);
    return { value: result, privateContractInput, privateParsedContract: contract };
}
function bounded(raw) {
    if (!raw || typeof raw !== 'object' || ownDataArrayIsArray(raw))
        throw Error('intent_application_limit');
    const descriptors = dataDescriptors(raw), contract = ownDescriptorValue(descriptors, 'contract'), candidateEntries = [];
    for (const key of capturedArrayIterator(ownDataReflectOwnKeys(descriptors)))
        if (typeof key === 'string' && key !== 'contract')
            append(candidateEntries, [key, ownDescriptorValue(descriptors, key)]);
    const candidate = applicationDataFromEntries(candidateEntries);
    if (ownDataBufferByteLength(json(contract)) > 65536)
        throw Error('intent_application_limit');
    const candidateBodyKind = candidate.body && typeof candidate.body === 'object' ? readApplicationOwnDataField(candidate.body, 'kind', 'intent_application_body') : null;
    if (candidateBodyKind?.kind !== 'data' || candidateBodyKind.value !== 'intent-parent') {
        if (ownDataBufferByteLength(json(candidate)) > 65536 || ownDataBufferByteLength(json(raw)) > 131084)
            throw Error('intent_application_limit');
        return;
    }
    const stages = contract.stages.length;
    if (ownDataBufferByteLength(json(raw)) > parentByteLimit(stages))
        throw Error('intent_application_limit');
    const metadata = { ...candidate, body: { ...candidate.body, artifacts: [] } };
    if (ownDataBufferByteLength(json(metadata)) > 65536 + 4096 * stages)
        throw Error('intent_application_limit');
    // Measurement only. Preserve the actual descriptors and full inherited provenance.
    const artifactsField = readApplicationOwnDataField(candidate.body, 'artifacts', 'intent_application_artifacts');
    if (artifactsField.kind !== 'data' || !ownDataArrayIsArray(artifactsField.value))
        throw Error('intent_application_artifacts');
    const groups = createCapturedMap();
    for (const artifact of capturedArrayIterator(artifactsField.value)) {
        if (!artifact || typeof artifact !== 'object')
            throw Error('intent_application_artifacts');
        const stageId = readApplicationOwnDataField(artifact, 'stageId', 'intent_application_artifacts'), selectionField = readApplicationOwnDataField(artifact, 'selection', 'intent_application_artifacts');
        if (stageId.kind !== 'data' || !selectionField.value || typeof selectionField.value !== 'object')
            throw Error('intent_application_artifacts');
        const selection = selectionField.value, selectionKind = readApplicationOwnDataField(selection, 'kind', 'intent_application_artifacts'), obligation = readApplicationOwnDataField(selection, selectionKind.kind === 'data' && selectionKind.value === 'inherited' ? 'originalObligationId' : 'obligationId', 'intent_application_artifacts'), path = readApplicationOwnDataField(selection, 'path', 'intent_application_artifacts');
        if (selectionKind.kind !== 'data' || obligation.kind !== 'data' || path.kind !== 'data')
            throw Error('intent_application_artifacts');
        const group = ownDataMapPrototypeGet(groups, stageId.value) ?? [];
        append(group, { ...artifact, selection: { kind: 'local', obligationId: obligation.value, path: path.value } });
        ownDataMapPrototypeSet(groups, stageId.value, group);
    }
    for (const group of capturedMapValuesIterator(groups))
        if (ownDataBufferByteLength(json(group)) > 65536)
            throw Error('intent_application_limit');
}
function artifacts(raw, stages) {
    if (!ownDataArrayIsArray(raw))
        throw Error('intent_application_artifacts');
    const seen = createCapturedSet();
    for (const artifact of capturedArrayIterator(raw)) {
        fields(artifact, 'artifactId stageId kind label summary createdAt content selection sha256 size');
        id(artifact.artifactId);
        id(artifact.stageId);
        const key = json([artifact.stageId, artifact.artifactId]);
        if (!ownDataSetPrototypeHas(stages, artifact.stageId) || ownDataSetPrototypeHas(seen, key))
            throw Error('intent_application_artifact_binding');
        ownDataSetPrototypeAdd(seen, key);
        if (!ownDataArrayPrototypeIncludes(['markdown', 'report', 'slides', 'summary', 'analysis', 'document', 'unknown'], artifact.kind))
            throw Error('intent_application_artifact_kind');
        text(artifact.label);
        if (artifact.summary !== null)
            text(artifact.summary);
        integer(artifact.createdAt);
        artifact.selection = parsePublishedArtifactSelection(artifact.selection);
        digest(artifact.sha256);
        integer(artifact.size);
        if (artifact.size > 16 * 1024 ** 2)
            throw Error('intent_application_artifact_size');
        const content = artifact.content;
        fields(content, content?.kind === 'inline' ? 'kind text' : 'kind originalPath');
        if (content.kind === 'inline') {
            text(content.text);
            const bytes = ownDataBufferFrom(content.text, 'utf8');
            if (ownDataBufferPrototypeToString(bytes, 'utf8') !== content.text || bytes.length !== artifact.size || ownDataHashPrototypeDigest(ownDataHashPrototypeUpdate(ownDataCryptoCreateHash('sha256'), bytes), 'hex') !== artifact.sha256)
                throw Error('intent_application_inline_content');
        }
        else if (content.kind === 'file') {
            text(content.originalPath);
            if (!content.originalPath)
                throw Error('intent_application_artifact_path');
        }
        else
            throw Error('intent_application_artifact_kind');
    }
}
function body(raw, subject, contract) {
    const bodyKind = raw && typeof raw === 'object' ? readApplicationOwnDataField(raw, 'kind', 'intent_application_body') : undefined;
    if (bodyKind?.kind === 'data' && bodyKind.value === 'intent-stage') {
        fields(raw, 'kind stageId summary executionReports artifacts' + (ownDataObjectHasOwn(raw, 'producerReports') ? ' producerReports' : ''));
        if (subject.stageId === null || raw.stageId !== subject.stageId)
            throw Error('intent_application_stage');
        const stage = capturedArrayFind(contract.stages, (stage) => stage.stageId === subject.stageId);
        if (!stage)
            throw Error('intent_application_stage');
        text(raw.summary);
        if (!ownDataArrayIsArray(raw.executionReports))
            throw Error('intent_application_reports');
        const seen = createCapturedSet();
        for (const report of capturedArrayIterator(raw.executionReports)) {
            fields(report, 'kind identity status requestSource recordedAt');
            id(report.identity);
            integer(report.recordedAt);
            if (!ownDataArrayPrototypeIncludes(['turn', 'step'], report.kind) || !ownDataArrayPrototypeIncludes(['completed', 'failed', 'stopped'], report.status) || !ownDataArrayPrototypeIncludes(['user', 'agent', 'scheduler'], report.requestSource))
                throw Error('intent_application_report');
            if (ownDataObjectHasOwn(raw, 'producerReports') && report.kind !== 'step')
                throw Error('intent_application_report_binding');
            if (report.kind === 'step' && !capturedArraySome(stage.steps, (step) => step.stepId === report.identity))
                throw Error('intent_application_report_binding');
            const key = json([report.kind, report.identity]);
            if (ownDataSetPrototypeHas(seen, key))
                throw Error('intent_application_report_duplicate');
            ownDataSetPrototypeAdd(seen, key);
        }
        artifacts(raw.artifacts, setFromDenseArray([stage.stageId]));
        if (ownDataObjectHasOwn(raw, 'producerReports')) {
            if (!ownDataArrayIsArray(raw.producerReports))
                throw Error('intent_application_reports');
            const origins = createCapturedSet(), reportedArtifacts = createCapturedSet();
            raw.producerReports = capturedArrayMap(raw.producerReports, (value) => {
                const report = parseIntentProducerReport(value), action = report.action, origin = json(action.origin);
                if (ownDataSetPrototypeHas(origins, origin))
                    throw Error('intent_application_report_duplicate');
                ownDataSetPrototypeAdd(origins, origin);
                if (action.kind === 'step-report') {
                    const matches = capturedArrayFilter(contract.stages, (s) => capturedArraySome(s.steps, (step) => step.stepId === action.stepId));
                    if (matches.length !== 1 || matches[0].stageId !== stage.stageId)
                        throw Error('intent_application_report_binding');
                }
                else {
                    const artifact = capturedArrayFind(raw.artifacts, (a) => a.artifactId === report.artifactId);
                    if (action.stageId !== stage.stageId || !artifact || ownDataSetPrototypeHas(reportedArtifacts, report.artifactId) || artifact.kind !== action.kindOfArtifact || artifact.label !== action.label || artifact.summary !== action.summary || artifact.createdAt !== report.now
                        || (action.storage === 'inline' ? (artifact.content.kind !== 'inline' || artifact.content.text !== action.inlineValue) : (artifact.content.kind !== 'file' || artifact.content.originalPath !== action.path)))
                        throw Error('intent_application_report_artifact');
                    ownDataSetPrototypeAdd(reportedArtifacts, report.artifactId);
                }
                return report;
            });
            if (ownDataSetPrototypeSizeGetter(reportedArtifacts) !== raw.artifacts.length)
                throw Error('intent_application_report_artifact');
        }
    }
    else if (bodyKind?.kind === 'data' && bodyKind.value === 'intent-parent') {
        fields(raw, 'kind summary stages artifacts');
        if (subject.stageId !== null)
            throw Error('intent_application_parent');
        text(raw.summary);
        if (!ownDataArrayIsArray(raw.stages) || raw.stages.length !== contract.stages.length)
            throw Error('intent_application_parent_stages');
        let index = 0;
        for (const reference of capturedArrayIterator(raw.stages)) {
            fields(reference, 'subject candidateId candidateRevision bindingHash immutablePayloadHash operationId fullTupleHash committedBusinessRevision receiverId receiverProtocolVersion receiverInstanceEpoch');
            reference.subject = parseIntentHostSubject(reference.subject);
            if (json(reference.subject) !== json({ ...subject, stageId: contract.stages[index].stageId }))
                throw Error('intent_application_parent_stages');
            for (const value of capturedArrayIterator([reference.candidateId, reference.operationId, reference.receiverId]))
                id(value);
            for (const value of capturedArrayIterator([reference.candidateRevision, reference.committedBusinessRevision]))
                integer(value, 1);
            integer(reference.receiverInstanceEpoch);
            for (const value of capturedArrayIterator([reference.bindingHash, reference.immutablePayloadHash, reference.fullTupleHash]))
                digest(value);
            if (reference.receiverProtocolVersion !== 1)
                throw Error('intent_application_receiver');
            index++;
        }
        artifacts(raw.artifacts, setFromDenseArray(capturedArrayMap(contract.stages, stage => stage.stageId)));
    }
    else
        throw Error('intent_application_body');
    return raw;
}
function parse(raw, create) {
    const captured = capture(raw), value = captured.value;
    fields(value, coreFields + (create ? '' : ' contractHash candidatePayloadHash'));
    if (value.version !== 1 || value.kind !== 'intent')
        throw Error('intent_application_kind');
    id(value.candidateId);
    integer(value.candidateRevision, 1);
    value.subject = parseIntentHostSubject(value.subject);
    value.contract = samePrivateContractData(captured.privateContractInput, value.contract) ? captured.privateParsedContract : parseIntentBusinessContract(value.contract);
    if (value.subject.sessionId !== value.contract.sessionId || value.subject.intentId !== value.contract.intentId)
        throw Error('intent_application_subject');
    value.body = body(value.body, value.subject, value.contract);
    const contractHash = hash(INTENT_BUSINESS_CONTRACT_HASH_DOMAIN, value.contract), candidatePayloadHash = hash('xiaok-intent-candidate-payload-v1', value.body);
    if (!create && (value.contractHash !== contractHash || value.candidatePayloadHash !== candidatePayloadHash))
        throw Error('intent_application_hash');
    defineData(value, 'contractHash', { __proto__: null, value: contractHash, enumerable: true, writable: true, configurable: true });
    defineData(value, 'candidatePayloadHash', { __proto__: null, value: candidatePayloadHash, enumerable: true, writable: true, configurable: true });
    fields(value, coreFields + ' contractHash candidatePayloadHash');
    bounded(value);
    return freeze(value);
}
export function createIntentApplicationBinding(raw) { return parse(raw, true); }
export function parseIntentApplicationBinding(raw) { return parse(raw, false); }
export function intentApplicationBindingHash(raw) { return hash('xiaok-intent-application-v1', parseIntentApplicationBinding(raw)); }
/** Validate the original nested value before an outer protocol clone can discard
 * non-JSON keys. This is data validation, not authority or native approval. */
export function assertIntentApplicationEnvelope(raw) {
    if (!raw || typeof raw !== 'object')
        return;
    const field = readApplicationOwnDataField(raw, 'binding', 'intent_application_data');
    if (field.kind !== 'data' || !field.value || typeof field.value !== 'object')
        return;
    const kind = readApplicationOwnDataField(field.value, 'kind', 'intent_application_data');
    if (kind.kind === 'data' && kind.value === 'intent') {
        const bodyKind = readApplicationOwnDataField(field.value, 'body', 'intent_application_data');
        if (bodyKind.kind === 'data' && bodyKind.value && typeof bodyKind.value === 'object') {
            const member = readApplicationOwnDataField(bodyKind.value, 'kind', 'intent_application_body');
            if (member.kind === 'missing')
                throw Error('intent_application_body');
        }
        parseIntentApplicationBinding(field.value);
    }
}
