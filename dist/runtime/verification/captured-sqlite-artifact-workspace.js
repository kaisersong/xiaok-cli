import { createHash } from 'node:crypto';
import { readProfileSourceCapture, readProfileSqliteSchema, assertProfileSqliteIntegrity, readProfileSqliteLosslessRows } from './profile-source-capture.js';
import { ARTIFACT_WORKSPACE_SOURCE_SCHEMA as SCHEMA, ARTIFACT_WORKSPACE_TABLES as TABLES, ARTIFACT_WORKSPACE_QUERIES as QUERIES } from './artifact-workspace-source-schema.js';
import { freezeCapturedData, parseCapturedSourceJson, capturedJsonHasOnlySafeIntegerLiterals } from './captured-source-json.js';
import { canonicalVerificationJson } from './protocol.js';
const hard = (domain, targetTable) => ({ domain, targetTable, relation: 'foreign-key' });
const soft = (domain, targetTable) => ({ domain, ...targetTable ? { targetTable } : {}, relation: 'declared' });
const RULES = freezeCapturedData({
    artifact_workspaces: { conversation_id: soft('conversation'), workspace_root_id: soft('workspace-root') },
    artifact_workspace_nodes: { workspace_id: hard('workspace', 'artifact_workspaces'), lineage_id: soft('lineage', 'artifact_lineages'), artifact_version_id: soft('version', 'artifact_workspace_versions'), created_by_task_id: soft('task') },
    artifact_workspace_relations: { workspace_id: hard('workspace', 'artifact_workspaces'), from_node_id: hard('node', 'artifact_workspace_nodes'), to_node_id: hard('node', 'artifact_workspace_nodes') },
    artifact_lineages: { workspace_id: hard('workspace', 'artifact_workspaces'), preferred_version_id: soft('version', 'artifact_workspace_versions') },
    artifact_workspace_versions: { lineage_id: hard('lineage', 'artifact_lineages'), parent_version_id: hard('version', 'artifact_workspace_versions'), source_task_id: soft('task'), producing_task_id: soft('task'), source_artifact_id: soft('artifact'), source_evidence_id: soft('evidence'), producing_agent_id: soft('agent'), external_task_ref: soft('external-task'), file_ref: soft('version-file-ref'), entry_ref: soft('package-entry-ref'), package_manifest_ref: soft('package-manifest-ref') },
    workspace_generation_requests: { workspace_id: hard('workspace', 'artifact_workspaces'), placeholder_node_id: hard('node', 'artifact_workspace_nodes'), source_version_id: hard('version', 'artifact_workspace_versions'), supersedes_request_id: hard('generation-request', 'workspace_generation_requests'), producing_task_id: soft('task'), external_task_ref: soft('external-task') },
    workspace_generation_leases: { generation_request_id: hard('generation-request', 'workspace_generation_requests'), workspace_id: hard('workspace', 'artifact_workspaces'), node_id: hard('node', 'artifact_workspace_nodes'), source_version_id: hard('version', 'artifact_workspace_versions'), producing_task_id: soft('task'), producing_agent_id: soft('agent') },
    artifact_workspace_projection_receipts: { generation_request_id: soft('generation-request', 'workspace_generation_requests'), produced_artifact_id: soft('artifact') },
    artifact_workspace_artifact_claims: { generation_request_id: soft('generation-request', 'workspace_generation_requests'), produced_artifact_id: soft('artifact') },
    artifact_workspace_staging_files: { generation_request_id: soft('generation-request', 'workspace_generation_requests'), producing_task_id: soft('task'), produced_artifact_id: soft('artifact'), file_ref: soft('staging-file-ref') },
    artifact_workspace_views: { workspace_id: hard('workspace', 'artifact_workspaces') },
    artifact_workspace_view_sessions: { workspace_id: hard('workspace', 'artifact_workspaces') },
    artifact_workspace_events: { workspace_id: hard('workspace', 'artifact_workspaces'), conversation_id: soft('conversation'), request_id: soft('request-correlation') },
    artifact_workspace_task_cursors: { task_id: soft('task') },
    artifact_workspace_audit_log: { workspace_id: hard('workspace', 'artifact_workspaces'), node_id: soft('node', 'artifact_workspace_nodes'), version_id: soft('version', 'artifact_workspace_versions'), producing_task_id: soft('task'), producing_agent_id: soft('agent') },
});
function fail(reason) { throw Error('captured_artifact_workspace_' + reason); }
function references(table, record) {
    const rules = { ...RULES[table] };
    if (table === 'artifact_workspace_artifact_claims') {
        const kind = record.outcome_kind;
        if (kind?.type !== 'text')
            fail('outcome');
        if (kind.value === 'ready_version')
            rules.outcome_id = soft('version', 'artifact_workspace_versions');
        else if (kind.value === 'staging')
            rules.outcome_id = soft('staging', 'artifact_workspace_staging_files');
        else
            fail('outcome');
    }
    if (table === 'artifact_workspace_audit_log') {
        const actor = record.actor_kind;
        if (actor?.type !== 'text')
            fail('actor');
        const domains = { user: 'actor-user', agent: 'actor-agent', scheduler: 'actor-scheduler', system_reconcile: 'actor-system-reconcile' };
        if (!Object.hasOwn(domains, actor.value))
            fail('actor');
        rules.actor_id = soft(domains[actor.value]);
    }
    return QUERIES[table].columns.flatMap(column => { const rule = rules[column], value = record[column]; return !rule || value.type === 'null' ? [] : [{ column, ...rule, value, referenceState: value.type === 'text' ? 'declared' : 'uninterpreted' }]; });
}
function metadata(cell) {
    if (cell?.type !== 'text')
        fail('metadata');
    const raw = cell.value, value = parseCapturedSourceJson(raw);
    const exact = capturedJsonHasOnlySafeIntegerLiterals(raw);
    if (exact && value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number'))
        return { classification: 'scalar-map', value: value };
    return { classification: 'uninterpreted-json', raw };
}
/** All rows still present in every matching held source. Events are declarations;
 * only full iteration yields complete, and even complete grants no authority. */
export function* iterateCapturedSQLiteArtifactWorkspaceSources(owner, token) {
    const capture = readProfileSourceCapture(owner, token), summaries = [], hash = createHash('sha256').update('xiaok-artifact-workspace-declarations-v1\0');
    function emit(event) { const encoded = canonicalVerificationJson(event); hash.update(String(Buffer.byteLength(encoded))).update(':').update(encoded); return freezeCapturedData(event); }
    for (const entry of [...capture.sources].sort((a, b) => a.source.sourceId < b.source.sourceId ? -1 : a.source.sourceId > b.source.sourceId ? 1 : 0)) {
        const { source, snapshotHash } = entry;
        if (source.kind !== 'sqlite-db' || source.snapshotFormat !== 'artifact-workspace-sqlite-v1')
            continue;
        const actual = readProfileSqliteSchema(owner, token, source.sourceId);
        if (actual.length !== SCHEMA.length || actual.some((row, i) => { const expected = SCHEMA[i]; return row.type !== expected.type || row.name !== expected.name || row.tbl_name !== expected.tbl_name || (typeof row.sql === 'string' ? row.sql.replace(/\s+/g, ' ').trim() : row.sql) !== expected.sql; }))
            fail('schema');
        assertProfileSqliteIntegrity(owner, token, source.sourceId);
        const counts = Object.fromEntries(TABLES.map(table => [table, 0]));
        yield emit({ kind: 'source-start', sourceId: source.sourceId, snapshotHash, format: 'artifact-workspace-sqlite-v1' });
        for (const table of TABLES) {
            for (const row of readProfileSqliteLosslessRows(owner, token, source.sourceId, table)) {
                counts[table]++;
                if (table === 'artifact_workspace_meta' && (counts[table] !== 1 || row.record.schema_version?.type !== 'integer' || row.record.schema_version.value !== '1'))
                    fail('meta');
                yield emit({ kind: 'row', sourceId: source.sourceId, table, rowid: row.rowid, record: row.record, parsedMetadata: table === 'artifact_workspace_events' ? metadata(row.record.metadata_json) : null, references: references(table, row.record) });
            }
            if (table === 'artifact_workspace_meta' && counts[table] !== 1)
                fail('meta');
        }
        readProfileSourceCapture(owner, token);
        yield emit({ kind: 'source-end', sourceId: source.sourceId, counts: counts });
        summaries.push(freezeCapturedData({ sourceId: source.sourceId, snapshotHash, counts }));
    }
    readProfileSourceCapture(owner, token);
    yield freezeCapturedData({ kind: 'complete', sources: summaries, digest: hash.digest('hex') });
}
