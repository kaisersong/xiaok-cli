import { readProfileSourceCapture, readProfileSqliteSchema, readProfileSqliteRows, assertProfileSessionFtsIntegrity } from './profile-source-capture.js';
import { capturedIdentity, capturedInteger, freezeCapturedData, parseCapturedSourceJson } from './captured-source-json.js';
import { parseSQLiteSessionSnapshot, extractMessageText } from '../../ai/runtime/session-store/sqlite-store.js';
import { readCapturedSessionDocument } from '../../ai/runtime/session-store/file-store.js';
import { captureMigrationMarker, computeSessionSnapshotHash } from '../../ai/runtime/session-store/migration.js';
import { SESSION_STORE_SCHEMA_VERSION } from '../../ai/runtime/session-store/schema.js';
import { SESSION_SOURCE_SCHEMA } from './session-source-schema.js';
function fail(reason) { throw Error('captured_sqlite_session_' + reason); }
function schema(owner, token, sourceId) {
    const actual = readProfileSqliteSchema(owner, token, sourceId);
    if (actual.length !== SESSION_SOURCE_SCHEMA.length || actual.some((row, index) => {
        const expected = SESSION_SOURCE_SCHEMA[index];
        return row.type !== expected.type || row.name !== expected.name || row.tbl_name !== expected.tbl_name
            || (row.sql === null ? null : typeof row.sql === 'string' ? row.sql.replace(/\s+/g, ' ').trim() : undefined) !== expected.sql;
    }))
        fail('schema');
    // Also checks the exact FTS/shadow definitions and original posting integrity
    // on a private disposable memory representation, never on the source file.
    assertProfileSessionFtsIntegrity(owner, token, sourceId);
}
const jsonFields = ['semantic_compaction_json', 'compound_operations_json', 'protected_observation_closure_json',
    'lineage_json', 'usage_json', 'compactions_json', 'memory_refs_json', 'approval_refs_json', 'background_job_refs_json',
    'intent_delegation_json', 'skill_eval_json', 'skill_execution_json'];
const requiredJson = new Set(['lineage_json', 'usage_json', 'compactions_json', 'memory_refs_json', 'approval_refs_json', 'background_job_refs_json']);
function originalRow(row) {
    capturedIdentity(row.session_id);
    if (typeof row.cwd !== 'string')
        fail('row');
    capturedInteger(row.created_at);
    capturedInteger(row.updated_at, row.created_at);
    for (const key of ['model', 'forked_from_session_id', 'prompt_snapshot_id'])
        if (row[key] !== null && typeof row[key] !== 'string')
            fail('row');
    if (row.store_revision !== null)
        capturedInteger(row.store_revision);
    if (row.history_digest !== null && (typeof row.history_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.history_digest)))
        fail('row');
    if (row.execution_protected !== null && row.execution_protected !== 0 && row.execution_protected !== 1)
        fail('row');
    for (const key of jsonFields) {
        const text = row[key];
        if (text === null && !requiredJson.has(key))
            continue;
        if (typeof text !== 'string')
            fail('json');
        const value = parseCapturedSourceJson(text);
        if (['lineage_json', 'compactions_json', 'memory_refs_json', 'approval_refs_json', 'background_job_refs_json'].includes(key) && !Array.isArray(value))
            fail('json');
    }
    return row;
}
/** All Session SQLite sources in the original branded capture. These are
 * declarations, not the complete profile attribution or capacity owners. */
export function readCapturedSQLiteSessionSources(owner, token) {
    const capture = readProfileSourceCapture(owner, token), sources = [];
    for (const entry of capture.sources) {
        if (entry.source.kind !== 'sqlite-db' || entry.source.snapshotFormat !== 'session-sqlite-v1')
            continue;
        const sourceId = entry.source.sourceId;
        schema(owner, token, sourceId);
        const rows = (query) => readProfileSqliteRows(owner, token, sourceId, query);
        const sessionRows = new Map();
        for (const raw of rows('session:sessions')) {
            const row = originalRow(raw);
            if (sessionRows.has(row.session_id))
                fail('duplicate');
            sessionRows.set(row.session_id, row);
        }
        const messages = new Map(), byMessageId = new Map();
        let maximumMessageId = 0;
        for (const raw of rows('session:session_messages')) {
            capturedIdentity(raw.session_id);
            capturedInteger(raw.message_id, 1);
            capturedInteger(raw.message_index);
            if (!sessionRows.has(raw.session_id) || byMessageId.has(raw.message_id) || typeof raw.content_json !== 'string' || typeof raw.text_content !== 'string')
                fail('message');
            parseCapturedSourceJson(raw.content_json);
            const row = raw, group = messages.get(row.session_id) ?? [];
            group.push(row);
            messages.set(row.session_id, group);
            byMessageId.set(row.message_id, row);
            maximumMessageId = Math.max(maximumMessageId, row.message_id);
        }
        const ftsIds = new Set();
        for (const row of rows('session:session_messages_fts')) {
            capturedInteger(row.rowid, 1);
            const message = byMessageId.get(row.rowid);
            if (!message || ftsIds.has(row.rowid) || row.session_id !== message.session_id || row.message_index !== message.message_index || row.text_content !== message.text_content)
                fail('fts');
            ftsIds.add(row.rowid);
        }
        if (ftsIds.size !== byMessageId.size)
            fail('fts');
        let sequenceSeen = false;
        for (const row of rows('session:sqlite_sequence')) {
            capturedInteger(row.seq);
            if (row.name !== 'session_messages' || sequenceSeen || row.seq < maximumMessageId)
                fail('sequence');
            sequenceSeen = true;
        }
        if (maximumMessageId && !sequenceSeen)
            fail('sequence');
        const meta = new Map();
        for (const row of rows('session:session_meta')) {
            if (typeof row.key !== 'string' || typeof row.value !== 'string' || !['schema_version', 'last_session'].includes(row.key) || meta.has(row.key))
                fail('meta');
            meta.set(row.key, row.value);
        }
        if (meta.get('schema_version') !== String(SESSION_STORE_SCHEMA_VERSION))
            fail('meta');
        const lastSessionReference = meta.get('last_session') ?? null;
        if (lastSessionReference !== null)
            capturedIdentity(lastSessionReference);
        const migrations = new Map();
        for (const row of rows('session:session_migrations')) {
            capturedIdentity(row.session_id);
            if (typeof row.marker_json !== 'string')
                fail('migration');
            const marker = captureMigrationMarker(parseCapturedSourceJson(row.marker_json));
            if (marker.sessionId !== row.session_id || !sessionRows.has(row.session_id) || migrations.has(row.session_id))
                fail('migration');
            migrations.set(row.session_id, marker);
        }
        const sessions = [];
        for (const [id, row] of [...sessionRows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
            const group = (messages.get(id) ?? []).sort((a, b) => a.message_index - b.message_index);
            if (group.some((message, index) => message.message_index !== index))
                fail('message_gap');
            const snapshot = parseSQLiteSessionSnapshot(row, group);
            const declaration = readCapturedSessionDocument(JSON.stringify({ schemaVersion: 1, ...snapshot }), id);
            for (let index = 0; index < group.length; index++)
                if (extractMessageText(snapshot.messages[index]) !== group[index].text_content)
                    fail('message_text');
            const migration = migrations.get(id);
            if (migration && ((snapshot.storeRevision ?? 0) !== migration.expectedStoreRevision || computeSessionSnapshotHash(snapshot) !== migration.expectedSnapshotHash))
                fail('migration_snapshot');
            sessions.push(declaration);
        }
        sources.push({ sourceId, snapshotHash: entry.snapshotHash, sessions, migrations: [...migrations.values()].sort((a, b) => a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0), lastSessionReference });
    }
    readProfileSourceCapture(owner, token);
    return freezeCapturedData({ kind: 'captured-sqlite-session-declarations', sources });
}
