import { captureApplicationData } from './application-value-data.js';
import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
import { parseLoopHostSubject } from './loop-host-subject.js';
import { parseLoopBusinessContract, loopBusinessContractHash } from './loop-application-contract.js';
import { parsePublishedArtifactSelection } from './published-artifact-selection.js';
export const LOOP_EVIDENCE_ANOMALY_KINDS = ['completed_without_evidence', 'artifact_kind_mismatch', 'legacy_unclassified_completion', 'source_unavailable', 'validation_failed'];
export const LOOP_HEALTH_DIAGNOSTIC_KINDS = ['service_not_running', 'port_occupied_by_unknown_process', 'health_unreachable', 'health_http_error', 'health_parse_error', 'health_identity_mismatch', 'health_capability_mismatch', 'broker_unavailable', 'spawn_path_missing', 'spawn_exit', 'source_hash_warning'];
const HASH_FIELDS = ['triggerHash', 'contractHash', 'candidatePayloadHash'];
const CANDIDATE_FIELDS = ['version', 'kind', 'subject', 'candidateId', 'candidateRevision', 'originalTriggerJson', 'logicalRunKey', 'contract', 'body'];
function shape(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    throw Error('loop_application_shape'); }
function id(value) { if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
    throw Error('loop_application_identity'); }
function text(value, allowEmpty = false) { if (typeof value !== 'string' || (!allowEmpty && !value.trim()))
    throw Error('loop_application_text'); }
function integer(value, min = 0) { if (!Number.isSafeInteger(value) || value < min)
    throw Error('loop_application_number'); }
function digest(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw Error('loop_application_hash'); }
function array(value) { if (!Array.isArray(value))
    throw Error('loop_application_array'); }
function strings(value) { array(value); value.forEach(item => text(item, true)); }
function freeze(value) { if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
} return value; }
function hash(domain, value) { return createHash('sha256').update(domain + '\0').update(value).digest('hex'); }
function capture(raw) { return JSON.parse(json(captureApplicationData(raw, { maximumBytes: 65536, maximumNodes: 65536, invalid: 'loop_application_shape', limit: 'loop_application_limit' }))); }
function artifactDescriptors(raw) {
    array(raw);
    const seen = new Set();
    for (const entry of raw) {
        shape(entry, ['selection', 'sha256', 'size']);
        entry.selection = parsePublishedArtifactSelection(entry.selection);
        digest(entry.sha256);
        integer(entry.size);
        if (entry.size > 16 * 1024 ** 2)
            throw Error('loop_application_artifact_size');
        const key = json(entry.selection);
        if (seen.has(key))
            throw Error('loop_application_artifact_duplicate');
        seen.add(key);
    }
}
function evidenceRefs(raw) { array(raw); if (!raw.length)
    throw Error('loop_application_evidence'); for (const ref of raw) {
    shape(ref, ['kind', 'id']);
    text(ref.kind);
    text(ref.id);
} }
function anomalies(raw, scanner) {
    array(raw);
    const seen = new Set();
    for (const item of raw) {
        shape(item, ['id', 'ownerKind', 'ownerId', 'kind', 'status', 'firstSeenAt', 'lastSeenAt', 'lastResolvedAt', 'seenCount', 'ignoredUntil', 'message', 'evidenceIds']);
        id(item.id);
        id(item.ownerId);
        if (seen.has(item.id))
            throw Error('loop_application_anomaly_duplicate');
        seen.add(item.id);
        if (!['task', 'loop_stage', 'loop_run', 'project', 'goal'].includes(item.ownerKind) || !['open', 'resolved', 'ignored'].includes(item.status))
            throw Error('loop_application_anomaly');
        if (scanner === 'artifact-evidence-regression') {
            if (!LOOP_EVIDENCE_ANOMALY_KINDS.includes(item.kind))
                throw Error('loop_application_anomaly');
        }
        else if (item.ownerKind !== 'loop_run' || item.ownerId !== 'kswarm-service' || ![...LOOP_HEALTH_DIAGNOSTIC_KINDS, 'source_unavailable'].includes(item.kind))
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
function candidateBody(input, subject, contract) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !('kind' in input))
        throw Error('loop_application_body');
    const raw = input;
    if (raw.kind === 'builtin-diagnostic') {
        shape(raw, ['kind', 'scanner', 'observedAt', 'summary', 'nextActionKind', 'nextActionSummary', 'diagnostic', 'artifacts']);
        if (contract.kind !== 'builtin-diagnostic' || contract.scanner !== raw.scanner || subject.loopId !== raw.scanner || (subject.stage !== null && subject.stage.stageKind !== 'scan'))
            throw Error('loop_application_body_binding');
        integer(raw.observedAt);
        text(raw.summary, true);
        if (raw.nextActionSummary !== null)
            text(raw.nextActionSummary, true);
        const artifact = raw.scanner === 'artifact-evidence-regression', actions = artifact ? ['none', 'inspect_anomalies', 'inspect_source'] : ['none', 'inspect_kswarm_health', 'inspect_kswarm_health_source'];
        if (!actions.includes(raw.nextActionKind))
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
            for (const key of ['diagnosticKinds', 'findings', 'suggestedActions', 'logPaths'])
                strings(d[key]);
            if (d.diagnosticKinds.some((kind) => ![...LOOP_HEALTH_DIAGNOSTIC_KINDS, 'source_unavailable'].includes(kind)))
                throw Error('loop_application_diagnostic');
        }
        anomalies(d.anomalies, raw.scanner);
    }
    else if (raw.kind === 'user-template-execute') {
        shape(raw, ['kind', 'taskId', 'executeStageId', 'summary', 'evidenceIds', 'artifacts']);
        if (contract.kind !== 'user-template' || subject.stage === null || subject.stage.stageKind !== 'execute' || subject.stage.stageId !== raw.executeStageId)
            throw Error('loop_application_body_binding');
        [raw.taskId, raw.executeStageId].forEach(id);
        text(raw.summary, true);
        strings(raw.evidenceIds);
    }
    else if (raw.kind === 'user-template') {
        shape(raw, ['kind', 'taskId', 'executeStageId', 'verifyStageId', 'summary', 'evidenceIds', 'artifacts']);
        if (contract.kind !== 'user-template' || subject.stage !== null && (subject.stage.stageKind !== 'verify' || subject.stage.stageId !== raw.verifyStageId))
            throw Error('loop_application_body_binding');
        [raw.taskId, raw.executeStageId, raw.verifyStageId].forEach(id);
        if (raw.executeStageId === raw.verifyStageId)
            throw Error('loop_application_stage_identity');
        text(raw.summary, true);
        strings(raw.evidenceIds);
    }
    else if (raw.kind === 'assistant-evening') {
        shape(raw, ['kind', 'summary', 'candidates', 'artifacts']);
        if (contract.kind !== 'assistant' || contract.assistantKind !== 'evening' || subject.stage !== null || subject.loopId !== 'personal-assistant-evening-reflection')
            throw Error('loop_application_body_binding');
        text(raw.summary);
        array(raw.candidates);
        let previous = null;
        for (const c of raw.candidates) {
            shape(c, ['id', 'runId', 'kind', 'title', 'content', 'scope', 'projectId', 'confidence', 'evidenceRefs', 'dedupeKey']);
            id(c.id);
            id(c.runId);
            if (previous !== null && Buffer.compare(Buffer.from(previous), Buffer.from(c.id)) >= 0)
                throw Error('loop_application_candidate_order');
            previous = c.id;
            if (c.runId !== subject.runId || !['memory', 'knowledge', 'follow_up'].includes(c.kind) || !['global', 'project'].includes(c.scope))
                throw Error('loop_application_candidate_binding');
            if (c.projectId !== null)
                text(c.projectId);
            if (c.scope === 'project' && c.projectId === null)
                throw Error('loop_application_candidate_project');
            if (typeof c.confidence !== 'number' || !Number.isFinite(c.confidence) || c.confidence < 0 || c.confidence > 1)
                throw Error('loop_application_candidate_confidence');
            text(c.title);
            text(c.content);
            text(c.dedupeKey);
            evidenceRefs(c.evidenceRefs);
        }
    }
    else if (raw.kind === 'assistant-morning') {
        shape(raw, ['kind', 'recommendations', 'artifacts']);
        if (contract.kind !== 'assistant' || contract.assistantKind !== 'morning' || subject.stage !== null || subject.loopId !== 'personal-assistant-morning-briefing')
            throw Error('loop_application_body_binding');
        array(raw.recommendations);
        if (raw.recommendations.length > 3)
            throw Error('loop_application_recommendations');
        for (const r of raw.recommendations) {
            shape(r, ['title', 'reasonCode', 'evidenceRefs']);
            text(r.title);
            text(r.reasonCode);
            evidenceRefs(r.evidenceRefs);
        }
    }
    else
        throw Error('loop_application_body_kind');
    artifactDescriptors(raw.artifacts);
    return raw;
}
function candidate(raw) {
    shape(raw, CANDIDATE_FIELDS);
    if (raw.version !== 1 || raw.kind !== 'loop')
        throw Error('loop_application_kind');
    raw.subject = parseLoopHostSubject(raw.subject);
    id(raw.candidateId);
    integer(raw.candidateRevision, 1);
    text(raw.originalTriggerJson);
    let trigger;
    try {
        trigger = JSON.parse(raw.originalTriggerJson);
    }
    catch {
        throw Error('loop_application_trigger');
    }
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger) || !('kind' in trigger) || typeof trigger.kind !== 'string' || !trigger.kind || json(trigger) !== raw.originalTriggerJson)
        throw Error('loop_application_trigger');
    if (raw.logicalRunKey !== null)
        text(raw.logicalRunKey);
    raw.contract = parseLoopBusinessContract(raw.contract);
    raw.body = candidateBody(raw.body, raw.subject, raw.contract);
    return raw;
}
/** Strict body value for a captured real subject and original business contract.
 * This creates no candidate identity, registration, or publication authority. */
export function parseLoopCandidateBody(raw, subject, contract) {
    return freeze(candidateBody(capture(raw), parseLoopHostSubject(subject), parseLoopBusinessContract(contract)));
}
function candidateHashes(value) {
    const triggerHash = hash('xiaok-loop-trigger-v1', value.originalTriggerJson), contractHash = loopBusinessContractHash(value.contract);
    const candidatePayloadHash = hash('xiaok-loop-candidate-payload-v1', json({ subject: value.subject, candidateId: value.candidateId, candidateRevision: value.candidateRevision, originalTriggerJson: value.originalTriggerJson, triggerHash, logicalRunKey: value.logicalRunKey, contractHash, body: value.body }));
    return { triggerHash, contractHash, candidatePayloadHash };
}
/** Pure immutable proposal only. The actual LoopStore capture, native approval,
 * registered subject and receiver publication remain separate requirements. */
export function createLoopApplicationBinding(raw) {
    const value = candidate(capture(raw));
    return parseLoopApplicationBinding({ ...value, ...candidateHashes(value) });
}
export function parseLoopApplicationBinding(raw) {
    const value = capture(raw);
    shape(value, [...CANDIDATE_FIELDS, ...HASH_FIELDS]);
    const base = { ...value };
    for (const field of HASH_FIELDS)
        delete base[field];
    const parsed = candidate(base), hashes = candidateHashes(parsed);
    for (const field of HASH_FIELDS) {
        digest(value[field]);
        if (value[field] !== hashes[field])
            throw Error('loop_application_hash_binding');
    }
    return freeze({ ...parsed, ...hashes });
}
export function loopApplicationBindingHash(raw) { return hash('xiaok-loop-application-binding-v1', json(parseLoopApplicationBinding(raw))); }
