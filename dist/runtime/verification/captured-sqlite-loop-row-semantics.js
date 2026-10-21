import { capturedFields, capturedIdentity, capturedInteger } from './captured-source-json.js';
import { parseLoopContractV1 } from '../loop/contract.js';
export function loopSemanticFailure(reason) { throw Error('captured_sqlite_loop_' + reason); }
export function loopObject(value) { if (!value || typeof value !== 'object' || Array.isArray(value))
    loopSemanticFailure('object'); return value; }
export function loopArray(value) { if (!Array.isArray(value))
    loopSemanticFailure('array'); return value; }
export function loopChoice(value, values) { if (!values.includes(value))
    loopSemanticFailure('enum'); }
export function loopIds(value) { const values = loopArray(value); for (const id of values)
    capturedIdentity(id); return values; }
const ownerKinds = ['task', 'loop_stage', 'loop_run', 'project', 'goal'];
const evidenceKinds = ['answer', 'file_artifact', 'command_action', 'project_update', 'log_diagnostic', 'blocked'];
const failures = ['verification_unavailable', 'verification_required', 'evidence_missing', 'evidence_kind_mismatch', 'validation_failed'];
/** Ordinary own-row declarations and constant-parent lookups. Run-scoped
 * publication/hash/history validation is a separate pass, never inferred here. */
export function validateCapturedLoopOrdinaryRow(reader, item) {
    const { table, value: row, json } = item, refs = [];
    const ref = (namespace, id, relation) => { capturedIdentity(id); refs.push({ namespace, id, relation, record: String(row.id ?? row.run_id ?? row.candidate_id ?? row.loop_id ?? '') }); };
    const one = (relation, id, required = true) => reader.one(relation, id, required)?.value;
    const sameOwner = (other) => { if (other.owner_kind !== row.owner_kind || other.owner_id !== row.owner_id)
        loopSemanticFailure('owner'); };
    if (table.startsWith('completion_')) {
        loopChoice(row.owner_kind, ownerKinds);
        capturedIdentity(row.owner_id);
        capturedIdentity(row.id);
        ref(String(row.owner_kind), row.owner_id, table + '.owner');
    }
    switch (table) {
        case 'completion_expectations':
            if (row.schema_version !== 1)
                loopSemanticFailure('version');
            loopIds(json.expected_kinds_json).forEach(kind => loopChoice(kind, evidenceKinds));
            loopChoice(row.source, ['task_spec', 'tool_schema', 'scheduler_executor_contract', 'loop_stage_contract', 'kswarm_deliverable_type', 'goal_criterion', 'legacy_classifier']);
            loopChoice(row.confidence, ['explicit', 'inferred', 'legacy']);
            loopObject(json.metadata_json);
            break;
        case 'completion_evidence':
            if (row.schema_version !== 1)
                loopSemanticFailure('version');
            loopChoice(row.kind, evidenceKinds);
            loopObject(json.metadata_json);
            break;
        case 'completion_records':
            loopChoice(row.status, ['completed', 'blocked']);
            loopChoice(row.ok, [0, 1]);
            if ((row.ok === 1) !== (row.failure_kind === null))
                loopSemanticFailure('completion_outcome');
            if (row.failure_kind !== null)
                loopChoice(row.failure_kind, failures);
            if (row.expectation_id !== null) {
                sameOwner(one('loop:expectation', row.expectation_id));
                ref('completion-expectation', row.expectation_id, table + '.expectation');
            }
            for (const id of loopIds(json.evidence_ids_json)) {
                sameOwner(one('loop:evidence', id));
                ref('completion-evidence', id, table + '.evidence');
            }
            break;
        case 'loop_definitions': {
            capturedIdentity(row.id);
            loopChoice(row.origin, ['built_in', 'user_template']);
            loopChoice(row.status, ['active', 'paused', 'deleted']);
            if (row.active_run_id !== null) {
                const active = one('loop:run', row.active_run_id, false);
                if (active && active.loop_id !== row.id)
                    loopSemanticFailure('active_run');
                ref('loop-run', row.active_run_id, table + '.active_run');
            }
            break;
        }
        case 'loop_runs':
            capturedIdentity(row.id);
            one('loop:definition', row.loop_id);
            loopChoice(row.status, ['running', 'success', 'failed', 'blocked']);
            capturedIdentity(loopObject(json.trigger_json).kind);
            loopIds(json.evidence_ids_json).forEach(id => ref('completion-evidence', id, table + '.evidence'));
            if (row.failure_kind !== null)
                loopChoice(row.failure_kind, ['executor_crash', 'executor_failed', 'validation_failed', 'evidence_missing', 'evidence_kind_mismatch', 'unknown']);
            break;
        case 'loop_stages': {
            capturedIdentity(row.id);
            const run = one('loop:run', row.run_id);
            if (run.loop_id !== row.loop_id)
                loopSemanticFailure('stage_run');
            loopChoice(row.stage_kind, ['scan', 'execute', 'verify']);
            loopChoice(row.status, ['pending', 'running', 'success', 'failed', 'blocked', 'skipped']);
            const metadata = loopObject(json.metadata_json);
            if (Object.hasOwn(metadata, 'taskId'))
                ref('task', metadata.taskId, table + '.task');
            if (Object.hasOwn(metadata, 'injectedConstraintIds'))
                loopIds(metadata.injectedConstraintIds).forEach(id => ref('loop-constraint', id, table + '.injected_constraint'));
            loopIds(json.evidence_ids_json).forEach(id => ref('completion-evidence', id, table + '.evidence'));
            break;
        }
        case 'assistant_candidates':
            capturedIdentity(row.id);
            one('loop:run', row.run_id);
            loopChoice(row.kind, ['memory', 'knowledge', 'follow_up']);
            loopChoice(row.scope, ['global', 'project']);
            loopChoice(row.status, ['staged', 'pending', 'accepting', 'accepted', 'rejected', 'superseded', 'accept_failed']);
            for (const value of loopArray(json.evidence_refs_json)) {
                capturedFields(value, ['kind', 'id']);
                const evidence = loopObject(value);
                capturedIdentity(evidence.kind);
                ref(evidence.kind, evidence.id, table + '.evidence');
            }
            if (row.project_id !== null)
                ref('project', row.project_id, table + '.project');
            if (row.target_kind !== null)
                loopChoice(row.target_kind, ['memory', 'knowledge', 'follow_up']);
            if (row.target_id !== null)
                ref('assistant-target', row.target_id, table + '.target');
            break;
        case 'loop_learned_constraints': {
            capturedIdentity(row.id);
            one('loop:definition', row.loop_id);
            loopChoice(row.source, ['llm_extraction', 'rule_extraction', 'user_manual']);
            if (row.deactivation_reason !== null)
                loopChoice(row.deactivation_reason, ['user', 'stale', 'ineffective', 'overflow', 'superseded']);
            loopChoice(row.active, [0, 1]);
            if (row.source_run_id !== null) {
                const run = one('loop:run', row.source_run_id, false);
                if (run && run.loop_id !== row.loop_id)
                    loopSemanticFailure('constraint_run');
                ref('loop-run', row.source_run_id, table + '.source_run');
            }
            if (row.superseded_by !== null)
                capturedIdentity(row.superseded_by);
            break;
        }
        case 'user_loop_templates':
            one('loop:definition', row.loop_id);
            loopChoice(row.kind, ['markdown_file', 'task_completion']);
            loopChoice(row.schedule_enabled, [0, 1]);
            loopChoice(row.auto_run_approved, [0, 1]);
            if (row.schedule_action_id !== null)
                ref('scheduled-action', row.schedule_action_id, table + '.schedule_action');
            if (row.contract_json !== null)
                parseLoopContractV1(json.contract_json, { registeredCriteria: ['task_completed', 'file_exists', 'command_exit_zero'] });
            break;
        case 'assistant_profiles':
            loopChoice(row.status, ['needs_consent', 'active', 'paused']);
            loopChoice(row.locale, ['zh', 'en']);
            loopArray(json.workdays_json).forEach(day => { capturedInteger(day); if (day > 6)
                loopSemanticFailure('workday'); });
            loopObject(json.quiet_hours_json);
            loopIds(json.data_scopes_json).forEach(scope => loopChoice(scope, ['threads', 'projects', 'tasks', 'artifacts', 'automations', 'meetings']));
            break;
        case 'automation_store_metadata':
            if (row.key !== 'version')
                loopSemanticFailure('metadata');
            capturedInteger(row.value);
            break;
        case 'evidence_anomalies': {
            capturedIdentity(row.id);
            loopChoice(row.loop_id, ['artifact-evidence-regression', 'kswarm-service-health']);
            loopChoice(row.status, ['open', 'resolved', 'ignored']);
            loopChoice(row.owner_kind, ownerKinds);
            capturedIdentity(row.owner_id);
            capturedInteger(row.seen_count, 1);
            const metadata = loopObject(json.metadata_json), ids = loopIds(json.evidence_ids_json);
            if (row.loop_id === 'artifact-evidence-regression') {
                loopChoice(row.kind, ['completed_without_evidence', 'artifact_kind_mismatch', 'legacy_unclassified_completion', 'source_unavailable', 'validation_failed']);
                if (row.kind === 'source_unavailable' && (row.owner_kind !== 'loop_run' || row.owner_id !== 'desktop-sqlite-completion-source' || ids.length))
                    loopSemanticFailure('scanner_source');
                for (const id of ids) {
                    sameOwner(one('loop:evidence', id));
                    ref('completion-evidence', id, table + '.evidence');
                }
                if (row.kind !== 'source_unavailable' && !Object.hasOwn(metadata, 'completionRecordId'))
                    loopSemanticFailure('scanner_record');
                if (Object.hasOwn(metadata, 'completionRecordId')) {
                    sameOwner(one('loop:completion-record', metadata.completionRecordId));
                    ref('completion-record', metadata.completionRecordId, table + '.completion_record');
                }
            }
            else {
                if (row.owner_kind !== 'loop_run' || row.owner_id !== 'kswarm-service' || ids.length)
                    loopSemanticFailure('health_evidence');
                loopChoice(row.kind, ['service_not_running', 'port_occupied_by_unknown_process', 'health_unreachable', 'health_http_error', 'health_parse_error', 'health_identity_mismatch', 'health_capability_mismatch', 'broker_unavailable', 'spawn_path_missing', 'spawn_exit', 'source_hash_warning', 'source_unavailable']);
            }
            if (Object.hasOwn(metadata, 'loopRunId'))
                ref('loop-run', metadata.loopRunId, table + '.scan_run');
            ref(String(row.owner_kind), row.owner_id, table + '.owner');
            break;
        }
    }
    return refs;
}
/** One visit per outgoing edge; IDs only, never retained rule/body rows. */
export function validateCapturedLoopConstraintChains(reader) {
    if (!reader.tables.includes('loop_learned_constraints'))
        return;
    const colors = new Map();
    for (const start of reader.rows('loop_learned_constraints')) {
        const id = start.value.id;
        capturedIdentity(id);
        if (colors.get(id) === 2)
            continue;
        const path = [];
        let current = start;
        while (current) {
            const own = current.value.id;
            capturedIdentity(own);
            const state = colors.get(own);
            if (state === 1)
                loopSemanticFailure('constraint_supersession');
            if (state === 2)
                break;
            colors.set(own, 1);
            path.push(own);
            const next = current.value.superseded_by;
            if (next === null)
                break;
            const following = reader.one('loop:constraint', next);
            if (following.value.loop_id !== start.value.loop_id)
                loopSemanticFailure('constraint_supersession');
            current = following;
        }
        for (const completed of path)
            colors.set(completed, 2);
    }
}
