import { deriveIntentParentBody } from './parent-candidate.js';
import { isDeepStrictEqual } from 'node:util';
import { captureIntentData } from './data.js';
import { applyIntentStepUpdate } from './dispatcher.js';
import { intentPublicationTarget, applyIntentPublicationCapture, readIntentPublicationRowFacts, intentPublicationFactArray, intentPublicationFactObject, parseIntentPublicationCandidates } from './publication-candidate-journal.js';
import { parseIntentReceiverAttempts } from './receiver-publication-journal.js';
import { intentNativeLedgerHash } from './native-contract-journal.js';
import { intentHostSubjectOwner } from '../verification/intent-host-subject.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
const shape = (v, keys) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.split(' ').sort().join(','))
    throw Error('intent_projection_shape'); };
const id = (v) => typeof v === 'string' && !!v && Buffer.byteLength(v) <= 160 && !/[\x00-\x1f\x7f]/.test(v);
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function parseIntentBusinessProjection(raw, candidate, ledger) {
    if (raw === undefined)
        return undefined;
    const row = captureIntentData(raw);
    shape(row, 'version candidateId receiverRequestId appliedAt clock publications' + (Object.hasOwn(row, 'nextStageContext') ? ' nextStageContext' : ''));
    if (row.nextStageContext !== undefined && row.nextStageContext !== null) {
        shape(row.nextStageContext, 'stageId messageCount messagesHash');
        if (!id(row.nextStageContext.stageId) || !Number.isSafeInteger(row.nextStageContext.messageCount) || row.nextStageContext.messageCount < 0 || !hash(row.nextStageContext.messagesHash))
            throw Error('intent_stage_context_shape');
    }
    const receiver = parseIntentReceiverAttempts(candidate.receiverAttempts, candidate).find(r => r.requestId === row.receiverRequestId), binding = intentPublicationTarget(ledger, candidate), stage = binding.contract.stages.find(s => s.stageId === candidate.stageId);
    if (row.version !== 1 || row.candidateId !== candidate.id || !receiver || receiver.status !== 'committed' || !receiver.observation || !Number.isSafeInteger(row.appliedAt) || row.appliedAt < receiver.updatedAt)
        throw Error('intent_projection_original');
    shape(row.clock, 'domainId qualificationEpoch lowerBound upperBound evidenceHash');
    if (!id(row.clock.domainId) || !hash(row.clock.evidenceHash) || ![row.clock.qualificationEpoch, row.clock.lowerBound, row.clock.upperBound].every(v => Number.isSafeInteger(v) && v >= 0) || row.clock.upperBound < row.clock.lowerBound)
        throw Error('intent_projection_clock');
    const ids = [candidate.stageId, ...(candidate.stageId === null ? binding.contract.stages.map(s => s.stageId) : stage.dependsOnStageIds)];
    if (!Array.isArray(row.publications) || row.publications.length !== ids.length)
        throw Error('intent_projection_inventory');
    row.publications.forEach((p, i) => {
        shape(p, 'owner operationId fullTupleHash businessRevision payloadHash bindingHash applicationRevision candidateRevision registrationHash');
        shape(p.owner, 'profileId ownerKind ownerId');
        const local = i === 0 ? candidate : readIntentPublicationRowFacts(ledger, candidate.intentId, ids[i]), application = local?.applicationAttempts.at(-1), route = application?.route && JSON.parse(application.route);
        if (!local || !route || application?.phase !== 'ready' || json(p.owner) !== json({ ...intentHostSubjectOwner({ ...binding.subject, stageId: ids[i] }), profileId: route.owner.profileId }) || !id(p.operationId) || ![p.fullTupleHash, p.payloadHash, p.bindingHash, p.registrationHash].every(hash) || ![p.businessRevision, p.applicationRevision, p.candidateRevision].every(v => Number.isSafeInteger(v) && v >= 1) || p.bindingHash !== local.bindingHash || p.candidateRevision !== local.candidateRevision || p.applicationRevision !== application.observation?.current?.revision || p.registrationHash !== application.observation.registrationHash)
            throw Error('intent_projection_binding');
        const fact = i === 0 ? receiver.observation : parseIntentReceiverAttempts(local.receiverAttempts, local).find(r => r.status === 'committed')?.observation;
        if (!fact || p.operationId !== fact.operationId || p.fullTupleHash !== fact.fullTupleHash || p.businessRevision !== fact.businessRevision || i > 0 && !local.businessProjection)
            throw Error('intent_projection_receiver');
    });
    if (candidate.businessProjection)
        assertIntentCandidateFactSource(ledger, candidate);
    return row;
}
function projectorRecords(value) {
    if (!Array.isArray(value))
        throw Error('intent_projection_records_data');
    return value;
}
function projectorStages(value) {
    if (!Array.isArray(value))
        throw Error('intent_projection_stages_data');
    return value;
}
function projectorSteps(value) {
    if (!Array.isArray(value))
        throw Error('intent_projection_steps_data');
    return value;
}
function projectorFact(value) {
    return intentPublicationFactObject(value, 'intent_projection_fact_data');
}
function projectorCandidate(value, candidateId) {
    if (value === undefined || value === null)
        return undefined;
    const row = intentPublicationFactArray(value, 'intent_projection_candidates_data').find(value => projectorFact(value).id === candidateId);
    return row === undefined ? undefined : projectorFact(row);
}
function assertProjectorCandidateIdentity(value) {
    if (typeof value.id !== 'string' || typeof value.intentId !== 'string' || value.stageId !== null && typeof value.stageId !== 'string')
        throw Error('intent_projection_candidate_data');
}
function assertProjectorCandidateData(value, parsed) {
    if (value.id !== parsed.id || value.intentId !== parsed.intentId || value.stageId !== parsed.stageId)
        throw Error('intent_projection_candidate_data');
    const body = projectorFact(value.body);
    for (const raw of intentPublicationFactArray(body.artifacts, 'intent_projection_artifacts_data')) {
        const artifact = projectorFact(raw), selection = projectorFact(artifact.selection);
        if (typeof artifact.artifactId !== 'string' || typeof selection.obligationId !== 'string' || typeof selection.path !== 'string')
            throw Error('intent_projection_artifacts_data');
    }
    for (const raw of intentPublicationFactArray(value.fileObservations, 'intent_projection_files_data')) {
        const file = projectorFact(raw);
        if (typeof file.artifactId !== 'string' || typeof file.sha256 !== 'string' || typeof file.identity !== 'string' || typeof file.size !== 'number')
            throw Error('intent_projection_files_data');
    }
}
function assertProjectorOwnerData(value) {
    if (typeof projectorFact(value).ownerInstanceId !== 'string')
        throw Error('intent_projection_owner_data');
}
function assertProjectorStepData(value) {
    if (typeof value !== 'string')
        throw Error('intent_projection_step_data');
}
function projectorTime(value) {
    if (typeof value !== 'number')
        throw Error('intent_projection_time_data');
    return value;
}
function assertProjectorArtifactFacts(value) {
    projectorFact(value);
}
export function projectIntentBusinessLedger(ledger, candidateId, raw) {
    const next = captureIntentData(ledger), candidate = projectorCandidate(next.publicationCandidates, candidateId);
    if (!candidate)
        throw Error('intent_projection_candidate');
    assertProjectorCandidateIdentity(candidate);
    const parsedCandidate = readIntentPublicationRowFacts(next, candidate.intentId, candidate.stageId);
    if (!parsedCandidate || parsedCandidate.id !== candidateId)
        throw Error('intent_projection_candidate');
    const projection = parseIntentBusinessProjection(raw, parsedCandidate, next);
    if (candidate.businessProjection) {
        if (!isDeepStrictEqual(candidate.businessProjection, projection))
            throw Error('intent_projection_immutable');
        return next;
    }
    const index = projectorRecords(next.intents).findIndex(r => r.intentId === candidate.intentId), record = next.intents[index], stage = record === null || record === undefined ? undefined : projectorStages(record.stages).find(s => s.stageId === candidate.stageId);
    if (candidate.stageId === null) {
        if (!record || next.activeIntentId !== record.intentId || record.overallStatus !== 'publication_pending' || projectorStages(record.stages).some(s => s.status !== 'completed') || projection.appliedAt < projectorTime(next.updatedAt) || projection.nextStageContext !== undefined && projection.nextStageContext !== null)
            throw Error('intent_projection_current');
        assertIntentCandidateFactSource(next, parsedCandidate);
        const updated = { ...record, overallStatus: 'completed' };
        next.intents[index] = updated;
        next.latestPlan = captureIntentData(updated);
        next.updatedAt = projection.appliedAt;
        candidate.businessProjection = projection;
        return next;
    }
    if (!record || !stage || next.activeIntentId !== record.intentId || record.activeStageId !== stage.stageId || record.overallStatus !== 'publication_pending' || stage.status !== 'publication_pending' || projectorSteps(stage.steps).some(s => s.status !== 'completed') || projection.appliedAt < projectorTime(next.updatedAt))
        throw Error('intent_projection_current');
    // Reuse the original complete candidate capture, including every report/artifact/selection.
    const snapshot = { sessionId: next.sessionId, intentDelegation: next, updatedAt: next.updatedAt };
    assertProjectorOwnerData(next.ownership);
    assertProjectorCandidateData(candidate, parsedCandidate);
    applyIntentPublicationCapture(snapshot, { publicationAction: 'reserve', sessionId: next.sessionId, instanceId: next.ownership.ownerInstanceId, expectedLedgerHash: intentNativeLedgerHash(next), requestSource: 'user', now: projection.appliedAt, artifactSelections: candidate.body.artifacts.map(a => ({ artifactId: a.artifactId, obligationId: a.selection.obligationId, path: a.selection.path })), fileObservations: candidate.fileObservations });
    assertProjectorStepData(record.activeStepId);
    let updated = applyIntentStepUpdate(record, { stepId: record.activeStepId, status: 'completed', now: projection.appliedAt });
    if (updated.overallStatus === 'completed')
        updated.overallStatus = 'publication_pending';
    const completed = projectorStages(updated.stages).find(s => s.stageId === stage.stageId);
    updated.artifacts = updated.artifacts?.map(a => { assertProjectorArtifactFacts(a); return a.stageId === stage.stageId ? { ...a, structuralValidation: completed.structuralValidation, semanticValidation: completed.semanticValidation } : a; });
    if (projection.nextStageContext !== undefined) {
        const nextStage = updated.activeStageId === stage.stageId ? undefined : projectorStages(updated.stages).find(s => s.stageId === updated.activeStageId);
        if (nextStage) {
            if (projection.nextStageContext?.stageId !== nextStage.stageId)
                throw Error('intent_stage_context_stage');
            nextStage.needsFreshContextHandoff = false;
        }
        else if (projection.nextStageContext !== null)
            throw Error('intent_stage_context_stage');
    }
    updated = captureIntentData(updated);
    next.intents[index] = updated;
    next.latestPlan = captureIntentData(updated);
    next.updatedAt = projection.appliedAt;
    candidate.businessProjection = projection;
    return next;
}
export function assertIntentBusinessProjectionTransition(before, after) {
    if (!before || !after)
        throw Error('intent_projection_original');
    const changed = parseIntentPublicationCandidates(after).filter(c => !isDeepStrictEqual(c.businessProjection, projectorCandidate(before.publicationCandidates, c.id)?.businessProjection));
    if (changed.length !== 1 || !changed[0].businessProjection || !isDeepStrictEqual(projectIntentBusinessLedger(before, changed[0].id, changed[0].businessProjection), after))
        throw Error('intent_projection_transition');
}
/** Pure comparison of historical producer facts; no status or permission is granted. */
export function assertIntentCandidateFactSource(ledger, candidate) {
    const record = ledger.intents.find(r => r.intentId === candidate.intentId);
    const selected = record ? intentPublicationFactArray(record.stages, 'intent_projection_source').find(value => intentPublicationFactObject(value, 'intent_projection_source').stageId === candidate.stageId) : undefined;
    const stage = selected === undefined ? undefined : intentPublicationFactObject(selected, 'intent_projection_source'), body = candidate.body;
    if (candidate.stageId === null) {
        if (body.kind !== 'intent-parent' || json(deriveIntentParentBody(ledger, candidate.intentId, body.stages)) !== json(body) || candidate.businessProjection && record?.overallStatus !== 'completed')
            throw Error('intent_projection_source');
        return;
    }
    if (!record || !stage || body.kind !== 'intent-stage')
        throw Error('intent_projection_source');
    const stepHas = (identity) => intentPublicationFactArray(stage.steps, 'intent_projection_source').some(value => intentPublicationFactObject(value, 'intent_projection_source').stepId === identity);
    const reports = intentPublicationFactArray(record.producerReports ?? [], 'intent_projection_source').filter(value => { const report = intentPublicationFactObject(value, 'intent_projection_source'), action = intentPublicationFactObject(report.action, 'intent_projection_source'); return action.kind === 'artifact-report' ? action.stageId === stage.stageId : stepHas(action.stepId); });
    const terminals = intentPublicationFactArray(record.executionTerminals ?? [], 'intent_projection_source').filter(value => { const terminal = intentPublicationFactObject(value, 'intent_projection_source'); return terminal.kind === 'step' && stepHas(terminal.identity); });
    const artifacts = intentPublicationFactArray(record.artifacts ?? [], 'intent_projection_source').filter(value => intentPublicationFactObject(value, 'intent_projection_source').stageId === stage.stageId);
    if (json(reports) !== json(body.producerReports ?? []) || json(terminals) !== json(body.executionReports) || artifacts.length !== body.artifacts.length)
        throw Error('intent_projection_source');
    artifacts.forEach((value, i) => { const a = intentPublicationFactObject(value, 'intent_projection_source'), b = body.artifacts[i]; if (!b || a.artifactId !== b.artifactId || a.stageId !== b.stageId || a.kind !== b.kind || a.label !== b.label || (a.summary ?? null) !== b.summary || a.createdAt !== b.createdAt || json(a.storage === 'inline' ? { kind: 'inline', text: a.inlineValue ?? '' } : { kind: 'file', originalPath: a.path }) !== json(b.content))
        throw Error('intent_projection_source'); });
    if (candidate.businessProjection) {
        const steps = intentPublicationFactArray(stage.steps, 'intent_projection_overlay'), semantic = steps.some(value => intentPublicationFactObject(value, 'intent_projection_overlay').key === 'validate') ? 'passed' : 'pending';
        if (stage.status !== 'completed' || steps.some(value => intentPublicationFactObject(value, 'intent_projection_overlay').status !== 'completed') || stage.structuralValidation !== 'passed' || stage.semanticValidation !== semantic || artifacts.some(value => { const a = intentPublicationFactObject(value, 'intent_projection_overlay'); return a.structuralValidation !== 'passed' || a.semanticValidation !== semantic; }))
            throw Error('intent_projection_overlay');
    }
}
