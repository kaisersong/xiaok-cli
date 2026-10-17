import { createHash } from 'node:crypto';
import { readProfileSourceCapture } from './profile-source-capture.js';
import { CapturedLoopSourceReader } from './captured-sqlite-loop-reader.js';
import { METADATA_SESSION_QUERIES } from './metadata-session-query-manifest.js';
import { capturedIdentity, capturedInteger, freezeCapturedData, parseCapturedSourceJson } from './captured-source-json.js';
import { canonicalVerificationJson as canonical } from './protocol.js';
import { validateCapturedLoopOrdinaryRow, validateCapturedLoopConstraintChains, loopSemanticFailure as fail, loopObject as object, loopIds as ids } from './captured-sqlite-loop-row-semantics.js';
import { assertCapturedLoopConfigurationOwner, readCapturedLoopRunBasis, readCapturedLoopBinding, validateCapturedLoopCandidateHistory } from './captured-sqlite-loop-publication.js';
import { CapturedLoopRunProjection, validateCapturedLoopResult, validateCapturedLoopCandidateVector, validateCapturedLoopProjectionHistory, parseCapturedLoopEmbeddedTask } from './captured-sqlite-loop-results.js';
import { parseLoopPublicationConfiguration } from '../loop/publication-config.js';
import { parseLoopApplicationBinding } from './loop-application-binding.js';
import { parseAssistantPromotionIntent } from '../loop/promotion-intent.js';
import { readLoopArtifactExportRow } from '../loop/artifact-export-journal.js';
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function ref(item, refs, namespace, id, relation) { capturedIdentity(id); refs.push({ namespace, id, relation, record: String(item.value.id ?? item.value.run_id ?? item.value.candidate_id ?? item.value.loop_id ?? '') }); }
function orphanEdges(reader, item) {
    const row = item.value, edges = {
        loop_publication_configs: [['loop:definition', 'loop_id']], loop_run_publication_basis: [['loop:run', 'run_id']],
        loop_producer_results: [['loop:run', 'run_id']], loop_stage_execution_results: [['loop:run', 'run_id'], ['loop:stage', 'stage_id']],
        loop_projection_origins: [['loop:run', 'run_id']], loop_projection_generations: [['loop:run', 'run_id']],
        loop_publication_candidates: [['loop:run', 'run_id']], loop_native_attempts: [['loop:publication-candidate', 'candidate_id']],
        loop_verification_sessions: [['loop:publication-candidate', 'candidate_id'], ['loop:native-attempt', 'native_attempt_id']],
        loop_verification_executions: [['loop:verification-session', 'session_record_id']],
        loop_publication_attempts: [['loop:publication-candidate', 'candidate_id'], ['loop:native-attempt', 'native_attempt_id']],
        loop_publication_candidate_members: [['loop:publication-candidate', 'candidate_id'], ['loop:assistant-member', 'assistant_candidate_id']],
        assistant_promotion_intents: [['loop:assistant-member', 'candidate_id']],
    };
    for (const [relation, key] of edges[item.table] ?? [])
        reader.one(relation, row[key]);
}
function validatePromotion(reader, item) {
    const row = item.value, value = parseAssistantPromotionIntent(item.json.record_json), member = reader.one('loop:assistant-member', row.candidate_id), target = value.target, m = member.value;
    const stable = `assistant-${m.kind === 'memory' ? 'memory' : m.kind === 'knowledge' ? 'source' : 'follow-up'}:${m.id}`;
    if (value.candidateId !== row.candidate_id || value.revision !== row.revision || canonical(value) !== row.record_json || target.targetId !== stable || m.decided_at !== value.updatedAt || m.kind === 'knowledge' && !target.collectionId || m.kind === 'memory' && m.scope === 'project' && (!target.projectId || !target.projectCwd))
        fail('promotion_target');
    if (m.run_id !== value.runId || m.title !== target.title || m.content !== target.content || m.scope !== target.scope || (m.project_id ?? undefined) !== target.projectId || canonical(member.json.evidence_refs_json) !== canonical(target.provenance.evidenceRefs) || m.target_id !== target.targetId || m.target_kind !== m.kind || m.status !== value.state || value.state === 'accepted' && m.accepted_target_ref !== value.targetRef)
        fail('promotion_member');
}
function validateSource(reader) {
    let highWater = 0, sequenceRows = 0, sequenceName, sequenceValue;
    for (const table of reader.tables)
        for (const item of reader.rows(table)) {
            validateCapturedLoopOrdinaryRow(reader, item);
            orphanEdges(reader, item);
            if (table === 'loop_publication_configs') {
                const row = item.value;
                capturedInteger(row.revision, 1);
                capturedInteger(row.created_at);
                capturedInteger(row.updated_at, row.created_at);
                const config = parseLoopPublicationConfiguration(item.json.configuration_json);
                if (canonical(config) !== row.configuration_json)
                    fail('configuration');
                assertCapturedLoopConfigurationOwner(String(row.loop_id), reader.one('loop:definition', row.loop_id).value, config.contract, config.contract.kind === 'user-template' && !!reader.one('loop:template', row.loop_id, false), true);
            }
            if (table === 'assistant_promotion_intents')
                validatePromotion(reader, item);
            if (table === 'loop_artifact_exports') {
                const record = readLoopArtifactExportRow(item.value), candidate = reader.one('loop:publication-candidate', record.source.candidateId), binding = parseLoopApplicationBinding(candidate.json.binding_json);
                if (binding.subject.loopId !== record.source.loopId || binding.subject.runId !== record.source.runId || binding.candidateRevision !== record.source.candidateRevision || !binding.body.artifacts.some(descriptor => canonical(descriptor) === canonical(record.source.descriptor)))
                    fail('export_source');
                highWater = Math.max(highWater, record.sequence);
            }
            if (table === 'sqlite_sequence') {
                sequenceRows++;
                sequenceName = item.value.name;
                sequenceValue = item.value.seq;
            }
        }
    if (highWater === 0 ? sequenceRows !== 0 : sequenceRows !== 1 || sequenceName !== 'loop_artifact_exports' || sequenceValue !== highWater)
        fail('export_sequence');
    validateCapturedLoopConstraintChains(reader);
    if (reader.tables.includes('loop_runs'))
        for (const run of reader.rows('loop_runs')) {
            const basis = readCapturedLoopRunBasis(reader, run), projection = new CapturedLoopRunProjection(reader, run);
            const result = reader.one('loop:producer-result', run.value.id, false);
            if (result) {
                if (!basis)
                    fail('result_basis');
                validateCapturedLoopResult(result, run, basis, projection);
            }
            for (const execution of reader.related('loop:run-execution-results', String(run.value.id))) {
                if (!basis)
                    fail('result_basis');
                validateCapturedLoopResult(execution, run, basis, projection);
            }
            for (const candidate of reader.related('loop:run-candidates', String(run.value.id))) {
                if (!basis)
                    fail('basis_missing');
                const binding = readCapturedLoopBinding(reader, candidate, run, basis);
                validateCapturedLoopCandidateHistory(reader, candidate, binding, basis);
                validateCapturedLoopCandidateVector(reader, candidate, run, basis, projection);
            }
            validateCapturedLoopProjectionHistory(reader, run, basis, projection);
        }
}
function declareRow(reader, item) {
    const refs = validateCapturedLoopOrdinaryRow(reader, item), embeddedTasks = [], row = item.value;
    const add = (namespace, id, relation) => ref(item, refs, namespace, id, relation);
    switch (item.table) {
        case 'loop_verification_sessions':
            add('session', row.session_id, 'loop_verification_sessions.session');
            add('verification-operation', row.operation_id, 'loop_verification_sessions.operation');
            add('validation-invocation', row.validation_invocation_id, 'loop_verification_sessions.invocation');
            break;
        case 'loop_publication_attempts': {
            const value = object(item.json.record_json);
            if (value.routeJson) {
                const owner = object(object(parseCapturedSourceJson(String(value.routeJson))).owner);
                add('profile', owner.profileId, 'loop_publication_attempts.profile');
                add(String(owner.ownerKind), owner.ownerId, 'loop_publication_attempts.owner');
            }
            if (value.challenge)
                add('publication-challenge', object(value.challenge).challengeId, 'loop_publication_attempts.challenge');
            if (value.observation)
                add('verification-operation', object(value.observation).operationId, 'loop_publication_attempts.operation');
            break;
        }
        case 'loop_verification_executions': {
            const value = object(item.json.record_json);
            add('material-request', value.materialRequestId, 'loop_verification_executions.material_request');
            add('verification-request', value.verificationRequestId, 'loop_verification_executions.verification_request');
            if (value.operationId)
                add('verification-operation', value.operationId, 'loop_verification_executions.operation');
            if (value.attemptId)
                add('verification-attempt', value.attemptId, 'loop_verification_executions.attempt');
            break;
        }
        case 'loop_producer_results':
        case 'loop_stage_execution_results':
            ids(item.json.evidence_ids_json).forEach(id => add('completion-evidence', id, item.table + '.evidence'));
            if (item.table === 'loop_stage_execution_results') {
                const task = parseCapturedLoopEmbeddedTask(item);
                embeddedTasks.push(task);
                if (task.completionObservation && object(task.completionObservation).kind === 'protected')
                    add('profile', object(object(object(task.completionObservation).state).owner).profileId, 'loop_stage_execution_results.historical_completion_profile');
                for (const id of task.declaration.sessionIdentities)
                    add('session', id, 'loop_stage_execution_results.task.session');
                for (const value of task.declaration.references)
                    add(value.namespace, value.id, 'loop_stage_execution_results.task.' + value.relation);
            }
            break;
        case 'loop_artifact_exports': {
            const value = readLoopArtifactExportRow(row);
            add('loop-candidate', value.source.candidateId, 'loop_artifact_exports.candidate');
            add('loop-run', value.source.runId, 'loop_artifact_exports.run');
            break;
        }
        case 'assistant_promotion_intents': {
            const value = parseAssistantPromotionIntent(item.json.record_json);
            add('assistant-candidate', value.candidateId, 'assistant_promotion_intents.candidate');
            add('assistant-target', value.target.targetId, 'assistant_promotion_intents.target');
            if (value.target.collectionId)
                add('knowledge-collection', value.target.collectionId, 'assistant_promotion_intents.collection');
            break;
        }
    }
    refs.sort((a, b) => compare(a.namespace, b.namespace) || compare(a.relation, b.relation) || compare(a.id, b.id) || compare(a.record, b.record));
    embeddedTasks.sort((a, b) => compare(a.stageId, b.stageId));
    return { references: refs, embeddedTasks };
}
/** Full historical declarations only. A prefix is never complete; neither the
 * stream nor its digest grants ownership, custody, or protected write authority. */
export function* iterateCapturedSQLiteLoopSources(owner, token) {
    const capture = readProfileSourceCapture(owner, token), hash = createHash('sha256').update('xiaok-captured-loop-declarations-v1\0'), sources = [];
    const seal = (event) => { readProfileSourceCapture(owner, token); freezeCapturedData(event); const bytes = Buffer.from(canonical(event)), length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(bytes.length)); hash.update(length).update(bytes); return event; };
    for (const entry of [...capture.sources].filter(e => e.source.kind === 'sqlite-db' && e.source.snapshotFormat === 'loop-sqlite-v1').sort((a, b) => compare(a.source.sourceId, b.source.sourceId))) {
        const sourceId = entry.source.sourceId, snapshotHash = entry.snapshotHash, reader = new CapturedLoopSourceReader(owner, token, sourceId), tables = [];
        try {
            validateSource(reader);
            yield seal({ kind: 'source-start', sourceId, snapshotHash });
            readProfileSourceCapture(owner, token);
            for (const table of reader.tables) {
                const columns = Object.entries(METADATA_SESSION_QUERIES).find(([id, value]) => ['loop', 'completion', 'artifactScanner'].includes(id.split(':')[0]) && value.table === table)?.[1].columns;
                if (!columns)
                    fail('query');
                yield seal({ kind: 'table-start', sourceId, table, columns });
                readProfileSourceCapture(owner, token);
                let ordinal = 0n;
                for (const row of reader.rows(table)) {
                    const declaration = declareRow(reader, row);
                    yield seal({ kind: 'row', sourceId, table, ordinal: String(ordinal++), rowid: row.rowid, cells: row.cells, parsed: row.json, ...declaration });
                    readProfileSourceCapture(owner, token);
                }
                const count = String(ordinal);
                tables.push({ table, count });
                yield seal({ kind: 'table-end', sourceId, table, count });
                readProfileSourceCapture(owner, token);
            }
            const count = { sourceId, snapshotHash, tables };
            sources.push(count);
            yield seal({ kind: 'source-end', ...count });
            readProfileSourceCapture(owner, token);
        }
        finally {
            reader.close();
        }
    }
    readProfileSourceCapture(owner, token);
    yield freezeCapturedData({ kind: 'complete', version: 1, sources, digest: hash.digest('hex') });
    readProfileSourceCapture(owner, token);
}
