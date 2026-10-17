import { createHash } from 'node:crypto';
import { readProfileSourceCapture, readProfileSqliteSchema, assertProfileSqliteIntegrity, readProfileSqliteLosslessRows } from './profile-source-capture.js';
import { KSWARM_STATE_SOURCE_SCHEMA as SCHEMA, KSWARM_STATE_TABLES as TABLES } from './kswarm-state-source-schema.js';
import { freezeCapturedData, parseCapturedSourceJson } from './captured-source-json.js';
import { canonicalVerificationJson } from './protocol.js';
const COLLECTIONS = new Set(['project', 'board', 'workflowRun', 'workflowProposal', 'finalDeliverable', 'reviewGateDecision', 'reviewCondition', 'humanAction']);
function fail(reason) { throw Error('captured_kswarm_state_' + reason); }
function references(table, record) {
    if (table === 'state_meta')
        return [];
    const collection = record.collection, body = record.state_json, checksum = record.checksum;
    if (collection?.type !== 'text' || !COLLECTIONS.has(collection.value))
        fail('collection');
    if (body?.type !== 'text' || checksum?.type !== 'text' || createHash('sha256').update(body.value, 'utf8').digest('hex') !== checksum.value)
        fail('checksum');
    // Validate only; preserve the original JSON text rather than exposing rounded Numbers.
    parseCapturedSourceJson(body.value);
    return ['entity_key', 'project_id'].flatMap(column => { const value = record[column]; return value.type === 'null' ? [] : [{ column, domain: 'kswarm:' + (column === 'project_id' ? 'project' : collection.value), value, referenceState: value.type === 'text' ? 'declared' : 'uninterpreted' }]; });
}
/** Complete means all rows of supplied captures, never a full-profile grant. */
export function* iterateCapturedSQLiteKSwarmStateSources(owner, token) {
    const capture = readProfileSourceCapture(owner, token), summaries = [], hash = createHash('sha256').update('xiaok-kswarm-state-declarations-v1\0');
    function emit(event) { const raw = canonicalVerificationJson(event); hash.update(String(Buffer.byteLength(raw, 'utf8'))).update(':').update(raw, 'utf8'); return freezeCapturedData(event); }
    for (const entry of [...capture.sources].sort((a, b) => a.source.sourceId < b.source.sourceId ? -1 : a.source.sourceId > b.source.sourceId ? 1 : 0)) {
        const { source, snapshotHash } = entry;
        if (source.kind !== 'sqlite-db' || source.snapshotFormat !== 'kswarm-state-sqlite-v1')
            continue;
        const actual = readProfileSqliteSchema(owner, token, source.sourceId);
        if (actual.length !== SCHEMA.length || actual.some((row, i) => { const expected = SCHEMA[i]; return row.type !== expected.type || row.name !== expected.name || row.tbl_name !== expected.tbl_name || (typeof row.sql === 'string' ? row.sql.replace(/\s+/g, ' ').trim() : row.sql) !== expected.sql; }))
            fail('schema');
        assertProfileSqliteIntegrity(owner, token, source.sourceId);
        const counts = { state_entities: 0, state_entity_history: 0, state_meta: 0 };
        yield emit({ kind: 'source-start', sourceId: source.sourceId, snapshotHash, format: 'kswarm-state-sqlite-v1' });
        for (const table of TABLES)
            for (const row of readProfileSqliteLosslessRows(owner, token, source.sourceId, table)) {
                counts[table]++;
                yield emit({ kind: 'row', sourceId: source.sourceId, table, rowid: row.rowid, record: row.record, references: references(table, row.record) });
            }
        readProfileSourceCapture(owner, token);
        yield emit({ kind: 'source-end', sourceId: source.sourceId, counts });
        summaries.push(freezeCapturedData({ sourceId: source.sourceId, snapshotHash, counts }));
    }
    readProfileSourceCapture(owner, token);
    yield freezeCapturedData({ kind: 'complete', sources: summaries, digest: hash.digest('hex') });
}
