import { createHash } from 'node:crypto';
import { capturedFields, capturedIdentity, capturedInteger, parseCapturedSourceJson } from './captured-source-json.js';
import { canonicalVerificationJson as canonical } from './protocol.js';
import { parseCapturedLoopSemanticRow } from './captured-sqlite-loop-values.js';
import { loopSemanticFailure as fail, loopObject as object, loopArray as array, loopIds as ids } from './captured-sqlite-loop-row-semantics.js';
import { capturedLoopBasisHash, readCapturedLoopBinding } from './captured-sqlite-loop-publication.js';
import { parseLoopCandidateBody } from './loop-application-binding.js';
import { parseLoopBusinessContract } from './loop-application-contract.js';
import { assertLoopProjectedMember, validateLoopProjectionOrigin, loopProjectionHash } from '../loop/business-projection.js';
import { readCapturedTaskDeclarations } from '../task-host/snapshot-store.js';
import { parseCurrentCompletionState } from './completion-client.js';
import { parseLoopPublicationSetObservation } from '../loop/published-set.js';
function string(value) { if (typeof value !== 'string')
    fail('text'); }
/** Only this run's original single JSON row and ID indices are retained. */
export class CapturedLoopRunProjection {
    reader;
    run;
    origin;
    beforeStages = new Map();
    constructor(reader, run) {
        this.reader = reader;
        this.run = run;
        const item = reader.one('loop:projection-origin', run.value.id, false);
        if (!item) {
            this.origin = null;
            return;
        }
        const value = object(item.json.record_json);
        capturedFields(value, ['before', 'after']);
        for (const raw of [value.before, value.after]) {
            const set = object(raw);
            capturedFields(set, ['run', 'stages', 'members']);
            const capturedRun = object(set.run);
            parseCapturedLoopSemanticRow('loop_runs', capturedRun);
            if (capturedRun.id !== run.value.id)
                fail('projection_run');
            const stageIds = new Set(), memberIds = new Set();
            for (const v of array(set.stages)) {
                const stage = object(v);
                parseCapturedLoopSemanticRow('loop_stages', stage);
                if (stage.run_id !== run.value.id || stage.loop_id !== run.value.loop_id || stageIds.has(stage.id))
                    fail('projection_stage');
                stageIds.add(stage.id);
            }
            for (const v of array(set.members)) {
                const member = object(v);
                parseCapturedLoopSemanticRow('assistant_candidates', member);
                if (member.run_id !== run.value.id || memberIds.has(member.id))
                    fail('projection_member');
                memberIds.add(member.id);
            }
        }
        const origin = value;
        validateLoopProjectionOrigin(origin);
        if (canonical(value) !== item.value.record_json || loopProjectionHash(value) !== item.value.origin_hash)
            fail('projection_hash');
        if (canonical(run.value) !== canonical(origin.after.run))
            fail('projection_rows_changed');
        let stageIndex = 0;
        for (const stage of reader.related('loop:run-stages', String(run.value.id))) {
            if (stageIndex >= origin.after.stages.length || canonical(stage.value) !== canonical(origin.after.stages[stageIndex]))
                fail('projection_rows_changed');
            stageIndex++;
        }
        if (stageIndex !== origin.after.stages.length)
            fail('projection_rows_changed');
        let memberIndex = 0;
        for (const member of reader.related('loop:run-members', String(run.value.id))) {
            const expected = origin.after.members[memberIndex++];
            if (!expected)
                fail('projection_rows_changed');
            assertLoopProjectedMember(member.value, expected);
            if (['accepting', 'accepted'].includes(String(member.value.status)))
                reader.one('loop:promotion-intent', member.value.id);
        }
        if (memberIndex !== origin.after.members.length)
            fail('projection_rows_changed');
        for (const stage of origin.before.stages)
            this.beforeStages.set(stage.id, stage);
        this.origin = origin;
    }
    *stagedMembers() {
        if (this.origin) {
            for (const member of this.origin.before.members)
                if (member.status === 'staged')
                    yield member;
        }
        else
            for (const member of this.reader.related('loop:run-members', String(this.run.value.id)))
                if (member.value.status === 'staged')
                    yield member.value;
    }
    hasExecution(stageId) { return !!this.reader.one('loop:execution-result', stageId, false); }
    stage(stageId) {
        const actual = this.reader.one('loop:stage', stageId).value;
        if (actual.run_id !== this.run.value.id)
            fail('result_stage');
        return this.beforeStages.get(String(stageId)) ?? actual;
    }
}
export function parseCapturedLoopEmbeddedTask(row) {
    const snapshot = object(row.json.task_snapshot_json), { currentCompletion, ...persisted } = snapshot;
    if (currentCompletion !== undefined) {
        const observation = object(currentCompletion);
        if (observation.kind === 'unavailable')
            capturedFields(observation, ['kind']);
        else if (observation.kind === 'protected') {
            capturedFields(observation, ['kind', 'state']);
            const state = object(observation.state), owner = object(state.owner);
            capturedIdentity(owner.profileId);
            capturedIdentity(snapshot.taskId);
            parseCurrentCompletionState(state, { profileId: owner.profileId, ownerKind: 'task', ownerId: snapshot.taskId });
        }
        else
            fail('execution_completion');
    }
    capturedIdentity(snapshot.taskId);
    return { stageId: String(row.value.stage_id), declaration: readCapturedTaskDeclarations(canonical(persisted), '', snapshot.taskId), completionObservation: currentCompletion ?? null };
}
export function validateCapturedLoopResult(item, run, basis, projection) {
    const row = item.value;
    if (row.run_id !== run.value.id)
        fail('result_stage');
    const stage = row.stage_id === null ? null : projection.stage(row.stage_id);
    string(row.body_json);
    if (row.revision !== 1 || capturedLoopBasisHash(row.body_json) !== row.body_hash || canonical(item.json.body_json) !== row.body_json)
        fail('result_hash');
    const body = parseLoopCandidateBody(item.json.body_json, { kind: 'loop-run', loopId: String(run.value.loop_id), runId: String(run.value.id), stage: stage ? { stageId: String(stage.id), stageKind: stage.stage_kind } : null }, parseLoopBusinessContract(basis.value.contract));
    ids(item.json.evidence_ids_json);
    capturedInteger(row.terminal_at, Number(object(object(basis.value.sourceRows).run).started_at));
    if (item.table === 'loop_stage_execution_results') {
        const snapshot = object(item.json.task_snapshot_json);
        string(row.task_snapshot_json);
        if (capturedLoopBasisHash(row.task_snapshot_json) !== row.task_snapshot_hash || canonical(snapshot) !== row.task_snapshot_json || snapshot.status !== 'completed' || !stage || stage.stage_kind !== 'execute' || body.kind !== 'user-template-execute' || body.taskId !== snapshot.taskId || object(parseCapturedSourceJson(String(stage.metadata_json))).taskId !== snapshot.taskId || canonical(body.evidenceIds) !== row.evidence_ids_json)
            fail('execution_snapshot');
        capturedInteger(snapshot.createdAt, Number(object(object(basis.value.sourceRows).run).started_at));
        capturedInteger(snapshot.updatedAt, snapshot.createdAt);
        if (Number(row.terminal_at) < snapshot.updatedAt)
            fail('execution_time');
        parseCapturedLoopEmbeddedTask(item);
    }
    else if (body.kind === 'user-template-execute')
        fail('result_kind');
    if (body.kind === 'user-template') {
        const execute = projection.stage(body.executeStageId), verify = projection.stage(body.verifyStageId);
        if (execute.stage_kind !== 'execute' || verify.stage_kind !== 'verify' || (!projection.hasExecution(body.executeStageId) && execute.status !== 'success') || object(parseCapturedSourceJson(String(execute.metadata_json))).taskId !== body.taskId || object(parseCapturedSourceJson(String(verify.metadata_json))).taskId !== body.taskId || canonical(body.evidenceIds) !== row.evidence_ids_json)
            fail('template_task');
    }
    else if (body.kind !== 'user-template-execute' && canonical(item.json.evidence_ids_json) !== '[]')
        fail('result_evidence');
    if (body.kind === 'assistant-evening') {
        let count = 0;
        for (const member of projection.stagedMembers()) {
            const value = { id: member.id, runId: member.run_id, kind: member.kind, title: member.title, content: member.content, scope: member.scope, projectId: member.project_id, confidence: member.confidence, evidenceRefs: parseCapturedSourceJson(String(member.evidence_refs_json)), dedupeKey: member.dedupe_key };
            if (count >= body.candidates.length || canonical(value) !== canonical(body.candidates[count++]))
                fail('result_members');
        }
        if (count !== body.candidates.length)
            fail('result_members');
    }
    return body;
}
/** Original canonical vector bytes, without accumulating the membership array. */
export function validateCapturedLoopCandidateVector(reader, candidate, run, basis, projection) {
    const row = candidate.value, binding = readCapturedLoopBinding(reader, candidate, run, basis), stage = row.stage_id === null ? null : projection.stage(row.stage_id);
    const result = binding.body.kind === 'user-template-execute' ? reader.one('loop:execution-result', binding.body.executeStageId) : reader.one('loop:producer-result', row.run_id);
    const body = validateCapturedLoopResult(result, run, basis, projection);
    if (canonical(body) !== canonical(binding.body))
        fail('candidate_body');
    const templateStages = [];
    let execution;
    if (body.kind === 'user-template-execute')
        execution = reader.one('loop:execution-result', body.executeStageId).value;
    if (body.kind === 'user-template') {
        templateStages.push(projection.stage(body.executeStageId), projection.stage(body.verifyStageId));
        execution = reader.one('loop:execution-result', body.executeStageId, false)?.value;
        for (const actual of templateStages)
            if (actual.run_id !== row.run_id || object(parseCapturedSourceJson(String(actual.metadata_json))).taskId !== body.taskId)
                fail('template_task');
    }
    const fields = { basis: basis.value, result: result.value, stage, templateStages, ...(execution ? { execution } : {}) }, hash = createHash('sha256').update('xiaok-loop-run-publication-basis-v1\0');
    hash.update('{');
    let firstField = true;
    for (const key of [...Object.keys(fields), 'members'].sort()) {
        if (!firstField)
            hash.update(',');
        firstField = false;
        hash.update(JSON.stringify(key) + ':');
        if (key !== 'members') {
            hash.update(canonical(fields[key]));
            continue;
        }
        hash.update('[');
        let count = 0;
        for (const member of reader.related('loop:candidate-members', String(row.candidate_id))) {
            if (body.kind !== 'assistant-evening')
                fail('candidate_members');
            const original = object(member.json.original_row_json);
            parseCapturedLoopSemanticRow('assistant_candidates', original);
            if (original.id !== member.value.assistant_candidate_id || original.run_id !== row.run_id || original.status !== 'staged' || canonical(original) !== member.value.original_row_json)
                fail('candidate_member');
            reader.one('loop:assistant-member', original.id);
            const value = { id: original.id, runId: original.run_id, kind: original.kind, title: original.title, content: original.content, scope: original.scope, projectId: original.project_id, confidence: original.confidence, evidenceRefs: parseCapturedSourceJson(String(original.evidence_refs_json)), dedupeKey: original.dedupe_key };
            if (count >= body.candidates.length || canonical(value) !== canonical(body.candidates[count]))
                fail('candidate_members');
            if (count++)
                hash.update(',');
            hash.update(canonical(original));
        }
        if (body.kind === 'assistant-evening' && count !== body.candidates.length)
            fail('candidate_members');
        hash.update(']');
    }
    hash.update('}');
    if (hash.digest('hex') !== row.source_vector_hash || row.created_at !== result.value.terminal_at)
        fail('source_vector');
}
export function validateCapturedLoopProjectionHistory(reader, run, basis, projection) {
    let generation = 0, previous = null;
    for (const item of reader.related('loop:run-projection-history', String(run.value.id))) {
        if (!projection.origin || !basis)
            fail('projection_origin');
        const row = item.value, value = object(item.json.record_json);
        capturedFields(value, ['runId', 'originHash', 'generation', 'previousGenerationHash', 'observation']);
        if (++generation > 32 || value.runId !== run.value.id || value.originHash !== loopProjectionHash(projection.origin) || value.generation !== generation || row.generation !== generation || value.previousGenerationHash !== previous || canonical(value) !== row.record_json || loopProjectionHash(value) !== row.generation_hash)
            fail('projection_generation');
        const observed = array(object(value.observation).publications);
        if (observed.length < 1 || observed.length > 3)
            fail('projection_inventory');
        const identities = new Set(), bindings = [], owners = [];
        for (const raw of observed) {
            const publication = object(raw), application = object(publication.application), original = object(application.binding);
            capturedIdentity(original.candidateId);
            if (identities.has(original.candidateId))
                fail('projection_inventory');
            identities.add(original.candidateId);
            const candidate = reader.one('loop:publication-candidate', original.candidateId), binding = readCapturedLoopBinding(reader, candidate, run, basis);
            if (canonical(binding) !== canonical(original))
                fail('projection_candidate');
            bindings.push(binding);
            let owner;
            for (const attempt of reader.related('loop:candidate-publication-history', binding.candidateId)) {
                const record = object(attempt.json.record_json);
                if (record.status !== 'committed' || !record.observation)
                    continue;
                const observation = object(record.observation);
                if (observation.status === 'committed' && observation.operationId === publication.operationId && observation.fullTupleHash === publication.fullTupleHash && observation.businessRevision === publication.businessRevision) {
                    owner = observation.owner;
                    break;
                }
            }
            if (!owner)
                fail('projection_publication');
            owners.push(owner);
        }
        let candidates = 0;
        for (const candidate of reader.related('loop:run-candidates', String(run.value.id))) {
            if (!identities.has(String(candidate.value.candidate_id)))
                fail('projection_inventory');
            candidates++;
        }
        if (candidates !== identities.size)
            fail('projection_inventory');
        parseLoopPublicationSetObservation(value.observation, bindings, owners);
        previous = row.generation_hash;
    }
    if (projection.origin && !generation)
        fail('projection_generation');
}
