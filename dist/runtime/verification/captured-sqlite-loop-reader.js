import { readProfileSourceCapture, openProfileSqliteReader, closeProfileSqliteReader, readProfileSqliteReaderSchema, iterateProfileSqliteReaderRows, iterateProfileSqliteReaderRelation, } from './profile-source-capture.js';
import { METADATA_SESSION_QUERIES } from './metadata-session-query-manifest.js';
import { metadataSessionRelationManifest } from './metadata-session-relation-manifest.js';
import { decodeCapturedLoopRow, parseCapturedLoopSemanticRow, readCapturedLoopSchema } from './captured-sqlite-loop-values.js';
/** Internal read-only semantic view of one already captured source. The actual
 * parser lifetime remains with the original profile reader; no caller SQL or
 * cached complete table is introduced here. */
export class CapturedLoopSourceReader {
    owner;
    token;
    tables;
    reader;
    closed = false;
    constructor(owner, token, sourceId) {
        this.owner = owner;
        this.token = token;
        this.reader = openProfileSqliteReader(owner, token, sourceId);
        try {
            this.tables = Object.freeze(readCapturedLoopSchema(readProfileSqliteReaderSchema(this.reader)).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
        }
        catch (error) {
            try {
                this.close();
            }
            catch (closeError) {
                throw new AggregateError([error, closeError], 'captured_sqlite_loop_schema_close_failed');
            }
            throw error;
        }
    }
    current() { if (this.closed)
        throw Error('captured_sqlite_loop_reader_closed'); readProfileSourceCapture(this.owner, this.token); }
    close() { if (this.closed)
        return; this.closed = true; closeProfileSqliteReader(this.reader); }
    parse(table, row) {
        const value = decodeCapturedLoopRow(table, row.record);
        return Object.freeze({ table, rowid: row.rowid, cells: row.record, value, json: parseCapturedLoopSemanticRow(table, value) });
    }
    *rows(table) {
        this.current();
        if (!this.tables.includes(table))
            throw Error('captured_sqlite_loop_table');
        const query = Object.entries(METADATA_SESSION_QUERIES).find(([id, spec]) => ['loop', 'completion', 'artifactScanner'].includes(id.split(':')[0]) && spec.table === table)?.[0];
        if (!query)
            throw Error('captured_sqlite_loop_query');
        for (const row of iterateProfileSqliteReaderRows(this.reader, query))
            yield this.parse(table, row);
    }
    *related(relation, key) {
        this.current();
        const table = METADATA_SESSION_QUERIES[metadataSessionRelationManifest[relation].queryId].table;
        if (!this.tables.includes(table))
            return;
        for (const row of iterateProfileSqliteReaderRelation(this.reader, relation, [key]))
            yield this.parse(table, row);
    }
    one(relation, key, required = true) {
        this.current();
        if (typeof key !== 'string' || !key)
            throw Error('captured_sqlite_loop_identity');
        if (metadataSessionRelationManifest[relation].cardinality !== 'zero-or-one')
            throw Error('captured_sqlite_loop_relation');
        const iterator = this.related(relation, key);
        try {
            const first = iterator.next();
            if (first.done) {
                if (required)
                    throw Error('captured_sqlite_loop_orphan');
                return undefined;
            }
            if (!iterator.next().done)
                throw Error('captured_sqlite_loop_duplicate_identity');
            return first.value;
        }
        finally {
            iterator.return();
        }
    }
}
