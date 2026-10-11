import { ownDataArrayIsArray, ownDataArrayPrototypeForEach, ownDataArrayPrototypeIncludes, ownDataArrayPrototypeJoin, ownDataArrayPrototypeSome, ownDataArrayPrototypeSort, ownDataBufferByteLength, ownDataBufferCompare, ownDataBufferFrom, ownDataCryptoCreateHash, ownDataHashPrototypeDigest, ownDataHashPrototypeUpdate, ownDataNumberIsFinite, ownDataNumberIsSafeInteger, ownDataObjectFreeze, ownDataObjectKeys, ownDataObjectValues, ownDataReflectOwnKeys, ownDataRegExpPrototypeTest, ownDataSetPrototypeAdd, ownDataSetPrototypeHas, ownDataStringPrototypeTrim } from './application-native-intrinsics.js';
import { capturedArrayIterator, createCapturedSet } from './application-iteration-intrinsics.js';
import { applicationDataDescriptors, captureApplicationData, readApplicationOwnDataField } from './application-value-data.js';
import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
import { parseLoopHostSubject, type LoopHostSubject } from './loop-host-subject.js';
import { parseLoopBusinessContract, loopBusinessContractHash, type LoopBusinessContract } from './loop-application-contract.js';
import { parsePublishedArtifactSelection, type PublishedArtifactSelection } from './published-artifact-selection.js';
const ownHas = Object.prototype.hasOwnProperty, apply = Reflect.apply, ownKeys = Reflect.ownKeys, getOwn = Object.getOwnPropertyDescriptor, reflectGet = Reflect.get, nativeJsonParse = JSON.parse;
function enumerableDataField(descriptors: PropertyDescriptorMap, key: string): boolean {
    const wrapper = getOwn(descriptors, key);
    if (!wrapper || !apply(ownHas, wrapper, ['value']))
        return false;
    const descriptor = apply(reflectGet, undefined, [wrapper, 'value', wrapper]);
    return !!descriptor && apply(ownHas, descriptor, ['value']) && apply(reflectGet, undefined, [descriptor, 'enumerable', descriptor]) === true;
}
export interface LoopArtifactDescriptor {
    selection: Readonly<PublishedArtifactSelection>;
    sha256: string;
    size: number;
}
export interface LoopCandidateEvidenceRef {
    kind: string;
    id: string;
}
export interface LoopAssistantCandidate {
    id: string;
    runId: string;
    kind: 'memory' | 'knowledge' | 'follow_up';
    title: string;
    content: string;
    scope: 'global' | 'project';
    projectId: string | null;
    confidence: number;
    evidenceRefs: readonly LoopCandidateEvidenceRef[];
    dedupeKey: string;
}
export interface LoopMorningRecommendation {
    title: string;
    reasonCode: string;
    evidenceRefs: readonly LoopCandidateEvidenceRef[];
}
export const LOOP_EVIDENCE_ANOMALY_KINDS = ['completed_without_evidence', 'artifact_kind_mismatch', 'legacy_unclassified_completion', 'source_unavailable', 'validation_failed'] as const;
const privateLOOP_EVIDENCE_ANOMALY_KINDS = ownDataObjectFreeze([...LOOP_EVIDENCE_ANOMALY_KINDS]);
export const LOOP_HEALTH_DIAGNOSTIC_KINDS = ['service_not_running', 'port_occupied_by_unknown_process', 'health_unreachable', 'health_http_error', 'health_parse_error', 'health_identity_mismatch', 'health_capability_mismatch', 'broker_unavailable', 'spawn_path_missing', 'spawn_exit', 'source_hash_warning'] as const;
const privateLOOP_HEALTH_DIAGNOSTIC_KINDS = ownDataObjectFreeze([...LOOP_HEALTH_DIAGNOSTIC_KINDS]);
export interface LoopDiagnosticAnomaly {
    id: string;
    ownerKind: 'task' | 'loop_stage' | 'loop_run' | 'project' | 'goal';
    ownerId: string;
    kind: typeof LOOP_EVIDENCE_ANOMALY_KINDS[number] | typeof LOOP_HEALTH_DIAGNOSTIC_KINDS[number];
    status: 'open' | 'resolved' | 'ignored';
    firstSeenAt: number;
    lastSeenAt: number;
    lastResolvedAt: number | null;
    seenCount: number;
    ignoredUntil: number | null;
    message: string;
    evidenceIds: readonly string[];
}
export type LoopDiagnostic = {
    kind: 'artifact-evidence-regression';
    scannedOwnerCount: number;
    openAnomalyCount: number;
    resolvedAnomalyCount: number;
    anomalies: readonly LoopDiagnosticAnomaly[];
} | {
    kind: 'kswarm-service-health';
    openAnomalyCount: number;
    resolvedAnomalyCount: number;
    anomalies: readonly LoopDiagnosticAnomaly[];
    diagnosticKinds: readonly string[];
    findings: readonly string[];
    suggestedActions: readonly string[];
    logPaths: readonly string[];
};
export type LoopCandidateBody = {
    kind: 'builtin-diagnostic';
    scanner: 'artifact-evidence-regression' | 'kswarm-service-health';
    observedAt: number;
    summary: string;
    nextActionKind: string;
    nextActionSummary: string | null;
    diagnostic: LoopDiagnostic;
    artifacts: readonly LoopArtifactDescriptor[];
} | {
    kind: 'user-template';
    taskId: string;
    executeStageId: string;
    verifyStageId: string;
    summary: string;
    evidenceIds: readonly string[];
    artifacts: readonly LoopArtifactDescriptor[];
} | {
    kind: 'user-template-execute';
    taskId: string;
    executeStageId: string;
    summary: string;
    evidenceIds: readonly string[];
    artifacts: readonly LoopArtifactDescriptor[];
} | {
    kind: 'assistant-evening';
    summary: string;
    candidates: readonly LoopAssistantCandidate[];
    artifacts: readonly LoopArtifactDescriptor[];
} | {
    kind: 'assistant-morning';
    recommendations: readonly LoopMorningRecommendation[];
    artifacts: readonly LoopArtifactDescriptor[];
};
export interface LoopApplicationBinding {
    version: 1;
    kind: 'loop';
    subject: Readonly<LoopHostSubject>;
    candidateId: string;
    candidateRevision: number;
    originalTriggerJson: string;
    triggerHash: string;
    logicalRunKey: string | null;
    contract: Readonly<LoopBusinessContract>;
    contractHash: string;
    body: Readonly<LoopCandidateBody>;
    candidatePayloadHash: string;
}
export type LoopApplicationCandidate = Omit<LoopApplicationBinding, 'triggerHash' | 'contractHash' | 'candidatePayloadHash'>;
const HASH_FIELDS = ['triggerHash', 'contractHash', 'candidatePayloadHash'];
const CANDIDATE_FIELDS = ['version', 'kind', 'subject', 'candidateId', 'candidateRevision', 'originalTriggerJson', 'logicalRunKey', 'contract', 'body'];
function shape(value: unknown, keys: readonly string[]): asserts value is Record<string, any> {
    if (!value || typeof value !== 'object' || ownDataArrayIsArray(value) || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(value)), ',') !== ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort([...keys]), ','))
        throw Error('loop_application_shape');
}
function id(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value || ownDataBufferByteLength(value) > 160 || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, value))
        throw Error('loop_application_identity');
}
function text(value: unknown, allowEmpty = false): asserts value is string {
    if (typeof value !== 'string' || (!allowEmpty && !ownDataStringPrototypeTrim(value)))
        throw Error('loop_application_text');
}
function integer(value: unknown, min = 0): asserts value is number {
    if (!ownDataNumberIsSafeInteger(value) || (value as number) < min)
        throw Error('loop_application_number');
}
function digest(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !ownDataRegExpPrototypeTest(/^[a-f0-9]{64}$/, value))
        throw Error('loop_application_hash');
}
function array(value: unknown): asserts value is any[] {
    if (!ownDataArrayIsArray(value))
        throw Error('loop_application_array');
}
function strings(value: unknown) { array(value); ownDataArrayPrototypeForEach(value, item => text(item, true)); }
function freeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        ownDataArrayPrototypeForEach(ownDataObjectValues(value), freeze);
        ownDataObjectFreeze(value);
    }
    return value;
}
function hash(domain: string, value: string) { return ownDataHashPrototypeDigest(ownDataHashPrototypeUpdate(ownDataHashPrototypeUpdate(ownDataCryptoCreateHash('sha256'), domain + '\0'), value), 'hex'); }
function capture(raw: unknown, limits: {
    maximumBytes: number;
    maximumNodes: number;
    invalid: string;
    limit: string;
} = { maximumBytes: 65536, maximumNodes: 65536, invalid: 'loop_application_shape', limit: 'loop_application_limit' }) { return apply(nativeJsonParse, JSON, [json(captureApplicationData(raw, limits))]); }
function artifactDescriptors(raw: unknown) {
    array(raw);
    const seen = createCapturedSet<string>();
    for (const entry of capturedArrayIterator(raw)) {
        shape(entry, ['selection', 'sha256', 'size']);
        entry.selection = parsePublishedArtifactSelection(entry.selection);
        digest(entry.sha256);
        integer(entry.size);
        if (entry.size > 16 * 1024 ** 2)
            throw Error('loop_application_artifact_size');
        const key = json(entry.selection);
        if (ownDataSetPrototypeHas(seen, key))
            throw Error('loop_application_artifact_duplicate');
        ownDataSetPrototypeAdd(seen, key);
    }
}
function evidenceRefs(raw: unknown) {
    array(raw);
    if (!raw.length)
        throw Error('loop_application_evidence');
    for (const ref of capturedArrayIterator(raw)) {
        shape(ref, ['kind', 'id']);
        text(ref.kind);
        text(ref.id);
    }
}
function anomalies(raw: unknown, scanner: string) {
    array(raw);
    const seen = createCapturedSet<string>();
    for (const item of capturedArrayIterator(raw)) {
        shape(item, ['id', 'ownerKind', 'ownerId', 'kind', 'status', 'firstSeenAt', 'lastSeenAt', 'lastResolvedAt', 'seenCount', 'ignoredUntil', 'message', 'evidenceIds']);
        id(item.id);
        id(item.ownerId);
        if (ownDataSetPrototypeHas(seen, item.id))
            throw Error('loop_application_anomaly_duplicate');
        ownDataSetPrototypeAdd(seen, item.id);
        if (!ownDataArrayPrototypeIncludes(['task', 'loop_stage', 'loop_run', 'project', 'goal'], item.ownerKind) || !ownDataArrayPrototypeIncludes(['open', 'resolved', 'ignored'], item.status))
            throw Error('loop_application_anomaly');
        if (scanner === 'artifact-evidence-regression') {
            if (!ownDataArrayPrototypeIncludes(privateLOOP_EVIDENCE_ANOMALY_KINDS, item.kind))
                throw Error('loop_application_anomaly');
        }
        else if (item.ownerKind !== 'loop_run' || item.ownerId !== 'kswarm-service' || !ownDataArrayPrototypeIncludes([...privateLOOP_HEALTH_DIAGNOSTIC_KINDS, 'source_unavailable'], item.kind))
            throw Error('loop_application_anomaly');
        integer(item.firstSeenAt);
        integer(item.lastSeenAt);
        integer(item.seenCount);
        if (item.lastResolvedAt !== null)
            integer(item.lastResolvedAt);
        if (item.ignoredUntil !== null)
            integer(item.ignoredUntil);
        text(item.message, true);
        strings(item.evidenceIds);
    }
}
function candidateBody(input: unknown, subject: Readonly<LoopHostSubject>, contract: Readonly<LoopBusinessContract>): Readonly<LoopCandidateBody> {
    if (!input || typeof input !== 'object' || ownDataArrayIsArray(input))
        throw Error('loop_application_body');
    const kindField = readApplicationOwnDataField(input, 'kind', 'loop_application_body');
    if (kindField.kind !== 'data')
        throw Error('loop_application_body');
    const raw = input as Record<string, any>;
    if (kindField.value === 'builtin-diagnostic') {
        shape(raw, ['kind', 'scanner', 'observedAt', 'summary', 'nextActionKind', 'nextActionSummary', 'diagnostic', 'artifacts']);
        if (contract.kind !== 'builtin-diagnostic' || contract.scanner !== raw.scanner || subject.loopId !== raw.scanner || (subject.stage !== null && subject.stage.stageKind !== 'scan'))
            throw Error('loop_application_body_binding');
        integer(raw.observedAt);
        text(raw.summary, true);
        if (raw.nextActionSummary !== null)
            text(raw.nextActionSummary, true);
        const artifact = raw.scanner === 'artifact-evidence-regression', actions = artifact ? ['none', 'inspect_anomalies', 'inspect_source'] : ['none', 'inspect_kswarm_health', 'inspect_kswarm_health_source'];
        if (!ownDataArrayPrototypeIncludes(actions, raw.nextActionKind))
            throw Error('loop_application_next_action');
        shape(raw.diagnostic, artifact ? ['kind', 'scannedOwnerCount', 'openAnomalyCount', 'resolvedAnomalyCount', 'anomalies'] : ['kind', 'openAnomalyCount', 'resolvedAnomalyCount', 'anomalies', 'diagnosticKinds', 'findings', 'suggestedActions', 'logPaths']);
        const d = raw.diagnostic;
        if (d.kind !== raw.scanner)
            throw Error('loop_application_diagnostic');
        integer(d.openAnomalyCount);
        integer(d.resolvedAnomalyCount);
        if (artifact)
            integer(d.scannedOwnerCount);
        else {
            for (const key of capturedArrayIterator(['diagnosticKinds', 'findings', 'suggestedActions', 'logPaths']))
                strings(d[key]);
            if (ownDataArrayPrototypeSome(d.diagnosticKinds, (kind: string) => !ownDataArrayPrototypeIncludes([...privateLOOP_HEALTH_DIAGNOSTIC_KINDS, 'source_unavailable'], kind as never)))
                throw Error('loop_application_diagnostic');
        }
        anomalies(d.anomalies, raw.scanner);
    }
    else if (kindField.value === 'user-template-execute') {
        shape(raw, ['kind', 'taskId', 'executeStageId', 'summary', 'evidenceIds', 'artifacts']);
        if (contract.kind !== 'user-template' || subject.stage === null || subject.stage.stageKind !== 'execute' || subject.stage.stageId !== raw.executeStageId)
            throw Error('loop_application_body_binding');
        ownDataArrayPrototypeForEach([raw.taskId, raw.executeStageId], id);
        text(raw.summary, true);
        strings(raw.evidenceIds);
    }
    else if (kindField.value === 'user-template') {
        shape(raw, ['kind', 'taskId', 'executeStageId', 'verifyStageId', 'summary', 'evidenceIds', 'artifacts']);
        if (contract.kind !== 'user-template' || subject.stage !== null && (subject.stage.stageKind !== 'verify' || subject.stage.stageId !== raw.verifyStageId))
            throw Error('loop_application_body_binding');
        ownDataArrayPrototypeForEach([raw.taskId, raw.executeStageId, raw.verifyStageId], id);
        if (raw.executeStageId === raw.verifyStageId)
            throw Error('loop_application_stage_identity');
        text(raw.summary, true);
        strings(raw.evidenceIds);
    }
    else if (kindField.value === 'assistant-evening') {
        shape(raw, ['kind', 'summary', 'candidates', 'artifacts']);
        if (contract.kind !== 'assistant' || contract.assistantKind !== 'evening' || subject.stage !== null || subject.loopId !== 'personal-assistant-evening-reflection')
            throw Error('loop_application_body_binding');
        text(raw.summary);
        array(raw.candidates);
        let previous: string | null = null;
        for (const c of capturedArrayIterator(raw.candidates)) {
            shape(c, ['id', 'runId', 'kind', 'title', 'content', 'scope', 'projectId', 'confidence', 'evidenceRefs', 'dedupeKey']);
            id(c.id);
            id(c.runId);
            if (previous !== null && ownDataBufferCompare(ownDataBufferFrom(previous), ownDataBufferFrom(c.id)) >= 0)
                throw Error('loop_application_candidate_order');
            previous = c.id;
            if (c.runId !== subject.runId || !ownDataArrayPrototypeIncludes(['memory', 'knowledge', 'follow_up'], c.kind) || !ownDataArrayPrototypeIncludes(['global', 'project'], c.scope))
                throw Error('loop_application_candidate_binding');
            if (c.projectId !== null)
                text(c.projectId);
            if (c.scope === 'project' && c.projectId === null)
                throw Error('loop_application_candidate_project');
            if (typeof c.confidence !== 'number' || !ownDataNumberIsFinite(c.confidence) || c.confidence < 0 || c.confidence > 1)
                throw Error('loop_application_candidate_confidence');
            text(c.title);
            text(c.content);
            text(c.dedupeKey);
            evidenceRefs(c.evidenceRefs);
        }
    }
    else if (kindField.value === 'assistant-morning') {
        shape(raw, ['kind', 'recommendations', 'artifacts']);
        if (contract.kind !== 'assistant' || contract.assistantKind !== 'morning' || subject.stage !== null || subject.loopId !== 'personal-assistant-morning-briefing')
            throw Error('loop_application_body_binding');
        array(raw.recommendations);
        if (raw.recommendations.length > 3)
            throw Error('loop_application_recommendations');
        for (const r of capturedArrayIterator(raw.recommendations)) {
            shape(r, ['title', 'reasonCode', 'evidenceRefs']);
            text(r.title);
            text(r.reasonCode);
            evidenceRefs(r.evidenceRefs);
        }
    }
    else
        throw Error('loop_application_body_kind');
    artifactDescriptors(raw.artifacts);
    return raw as unknown as Readonly<LoopCandidateBody>;
}
function candidate(raw: unknown, parsedTrigger?: unknown, triggerWasParsed = false): LoopApplicationCandidate {
    if (!raw || typeof raw !== 'object' || ownDataArrayIsArray(raw))
        throw Error('loop_application_shape');
    const rawRecord = raw as Record<string, any>;
    // Preserve the historical whole-candidate shape gate before inspecting trigger data.
    const inputKeys = ownDataReflectOwnKeys(raw);
    if (ownDataArrayPrototypeSome(inputKeys, k => typeof k !== 'string') || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(raw)), ',') !== ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort([...CANDIDATE_FIELDS]), ','))
        throw Error('loop_application_shape');
    if (rawRecord.version !== 1 || rawRecord.kind !== 'loop')
        throw Error('loop_application_kind');
    rawRecord.subject = parseLoopHostSubject(rawRecord.subject);
    id(rawRecord.candidateId);
    integer(rawRecord.candidateRevision, 1);
    text(rawRecord.originalTriggerJson);
    let trigger: unknown = parsedTrigger;
    if (!triggerWasParsed)
        try {
            trigger = JSON.parse(rawRecord.originalTriggerJson);
        }
        catch {
            throw Error('loop_application_trigger');
        }
    if (!trigger || typeof trigger !== 'object' || ownDataArrayIsArray(trigger))
        throw Error('loop_application_trigger');
    const triggerKind = readApplicationOwnDataField(trigger, 'kind', 'loop_application_trigger');
    if (triggerKind.kind !== 'data' || typeof triggerKind.value !== 'string' || !triggerKind.value || json(trigger) !== rawRecord.originalTriggerJson)
        throw Error('loop_application_trigger');
    if (rawRecord.logicalRunKey !== null)
        text(rawRecord.logicalRunKey);
    rawRecord.contract = parseLoopBusinessContract(rawRecord.contract);
    rawRecord.body = candidateBody(rawRecord.body, rawRecord.subject, rawRecord.contract);
    return rawRecord as unknown as LoopApplicationCandidate;
}
/** Strict body value for a captured real subject and original business contract.
 * This creates no candidate identity, registration, or publication authority. */
export function parseLoopCandidateBody(raw: unknown, subject: unknown, contract: unknown): Readonly<LoopCandidateBody> {
    return freeze(candidateBody(capture(raw), parseLoopHostSubject(subject), parseLoopBusinessContract(contract)));
}
function candidateHashes(value: LoopApplicationCandidate) {
    const triggerHash = hash('xiaok-loop-trigger-v1', value.originalTriggerJson), contractHash = loopBusinessContractHash(value.contract);
    const candidatePayloadHash = hash('xiaok-loop-candidate-payload-v1', json({ subject: value.subject, candidateId: value.candidateId, candidateRevision: value.candidateRevision, originalTriggerJson: value.originalTriggerJson, triggerHash, logicalRunKey: value.logicalRunKey, contractHash, body: value.body }));
    return { triggerHash, contractHash, candidatePayloadHash };
}
/** Pure immutable proposal only. The actual LoopStore capture, native approval,
 * registered subject and receiver publication remain separate requirements. */
export function createLoopApplicationBinding(raw: unknown): Readonly<LoopApplicationBinding> {
    if (!raw || typeof raw !== 'object' || ownDataArrayIsArray(raw))
        throw Error('loop_application_shape');
    const root = applicationDataDescriptors(raw, CANDIDATE_FIELDS.length, 'loop_application_shape'), rootKeys = ownKeys(root);
    if (rootKeys.length !== CANDIDATE_FIELDS.length)
        throw Error('loop_application_shape');
    for (const field of capturedArrayIterator(CANDIDATE_FIELDS))
        if (!apply(ownHas, root, [field]) || !enumerableDataField(root, field))
            throw Error('loop_application_shape');
    const rootValue = (field: string) => {
        const item = readApplicationOwnDataField(raw, field, 'loop_application_shape');
        if (item.kind !== 'data')
            throw Error('loop_application_shape');
        return item.value;
    };
    const shallow = { version: rootValue('version'), kind: rootValue('kind'), subject: rootValue('subject'), candidateId: rootValue('candidateId'), candidateRevision: rootValue('candidateRevision'), originalTriggerJson: rootValue('originalTriggerJson'), logicalRunKey: rootValue('logicalRunKey'), contract: rootValue('contract'), body: rootValue('body') };
    if (shallow.version !== 1 || shallow.kind !== 'loop')
        throw Error('loop_application_kind');
    const shallowSubject = capture(shallow.subject, { maximumBytes: 4096, maximumNodes: 4096, invalid: 'loop_application_shape', limit: 'loop_application_limit' });
    const subject = parseLoopHostSubject(shallowSubject);
    id(shallow.candidateId);
    integer(shallow.candidateRevision, 1);
    text(shallow.originalTriggerJson);
    if (ownDataBufferByteLength(shallow.originalTriggerJson) > 65536)
        throw Error('loop_application_limit');
    let captured: Record<string, any> | undefined, captureError: unknown;
    try {
        captured = capture(raw) as Record<string, any>;
    }
    catch (error) {
        captureError = error;
    }
    if (captured && (captured.version !== shallow.version || captured.kind !== shallow.kind || captured.candidateId !== shallow.candidateId || captured.candidateRevision !== shallow.candidateRevision || captured.originalTriggerJson !== shallow.originalTriggerJson || json(captured.subject) !== json(shallowSubject)))
        throw Error('loop_application_shape');
    let originalTrigger: unknown;
    try {
        originalTrigger = JSON.parse(captured?.originalTriggerJson ?? shallow.originalTriggerJson);
    }
    catch {
        throw Error('loop_application_trigger');
    }
    if (!originalTrigger || typeof originalTrigger !== 'object' || ownDataArrayIsArray(originalTrigger))
        throw Error('loop_application_trigger');
    const triggerKind = readApplicationOwnDataField(originalTrigger, 'kind', 'loop_application_trigger');
    if (triggerKind.kind !== 'data' || typeof triggerKind.value !== 'string' || !triggerKind.value)
        throw Error('loop_application_trigger');
    if (json(originalTrigger) !== (captured?.originalTriggerJson ?? shallow.originalTriggerJson))
        throw Error('loop_application_trigger');
    if (captureError !== undefined)
        throw captureError;
    const value = candidate(captured!, originalTrigger, true);
    if (json(value.subject) !== json(subject))
        throw Error('loop_application_shape');
    return parseBinding({ ...value, ...candidateHashes(value) }, originalTrigger, true);
}
function parseBinding(raw: unknown, parsedTrigger?: unknown, triggerWasParsed = false): Readonly<LoopApplicationBinding> {
    const value = capture(raw);
    shape(value, [...CANDIDATE_FIELDS, ...HASH_FIELDS]);
    const base = { ...value };
    for (const field of capturedArrayIterator(HASH_FIELDS))
        delete base[field];
    const parsed = candidate(base, parsedTrigger, triggerWasParsed), hashes = candidateHashes(parsed);
    for (const field of capturedArrayIterator(HASH_FIELDS)) {
        digest(value[field]);
        if (value[field] !== hashes[field as keyof typeof hashes])
            throw Error('loop_application_hash_binding');
    }
    return freeze({ ...parsed, ...hashes });
}
export function parseLoopApplicationBinding(raw: unknown): Readonly<LoopApplicationBinding> { return parseBinding(raw); }
export function loopApplicationBindingHash(raw: unknown): string { return hash('xiaok-loop-application-binding-v1', json(parseLoopApplicationBinding(raw))); }
