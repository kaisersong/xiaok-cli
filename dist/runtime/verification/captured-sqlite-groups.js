import { createHash } from 'node:crypto';
import { readProfileSourceCapture, openProfileSqliteReader, closeProfileSqliteReader, readProfileSqliteReaderSchema, readProfileSqliteReaderUserVersion, iterateProfileSqliteReaderRows, iterateProfileSqliteReaderRelation } from './profile-source-capture.js';
import { METADATA_SESSION_QUERIES } from './metadata-session-query-manifest.js';
import { readCapturedGroupsSchema } from './groups-source-schema.js';
import { readCapturedGroupsRow, groupsObject } from './captured-sqlite-groups-row.js';
import { declareCapturedGroupsRow } from './captured-sqlite-groups-references.js';
import { encodeMultiAgentRow } from '../multi-agent/row-codec.js';
import { freezeCapturedData, capturedFields } from './captured-source-json.js';
function fail(reason) { throw Error('captured_groups_' + reason); }
function scalar(row, key) { const cell = row.cells[key]; if (cell?.type !== 'text')
    fail('identity'); return cell.value; }
function integer(row, key) { const cell = row.cells[key]; if (cell?.type !== 'integer' || BigInt(cell.value) < 0n)
    fail('counter'); return BigInt(cell.value); }
function one(reader, relation, table, keys) {
    const iterator = iterateProfileSqliteReaderRelation(reader, relation, keys);
    try {
        const first = iterator.next();
        if (first.done)
            fail('relation');
        const row = readCapturedGroupsRow(table, first.value);
        if (!iterator.next().done)
            fail('relation_cardinality');
        return row;
    }
    finally {
        iterator.return();
    }
}
function messageDigest(value) { const { groupId, messageId, sender, receiverId, kind, preview, contentId, truncated, createdAt, bodyUnavailable } = value; return createHash('sha256').update(encodeMultiAgentRow({ groupId, messageId, sender, receiverId, kind, preview, contentId, truncated, createdAt, bodyUnavailable })).digest('hex'); }
function relationships(reader, row) {
    const body = row.json.data_json === undefined ? undefined : groupsObject(row.json.data_json);
    if (row.table === 'thread_bindings' && row.cells.active_group_id?.type === 'text') {
        const group = one(reader, 'groups:group', 'groups', [row.cells.active_group_id.value]);
        if (scalar(group, 'thread_id') !== scalar(row, 'thread_id'))
            fail('active_thread');
    }
    if (row.table === 'groups') {
        let bytes = integer(row, 'logical_bytes'), events = 0n;
        const id = scalar(row, 'group_id');
        for (const table of ['agents', 'events', 'messages', 'contents', 'operations', 'root_turns', 'managed_resources'])
            for (const raw of iterateProfileSqliteReaderRelation(reader, ('groups:group-' + table), [id])) {
                const item = readCapturedGroupsRow(table, raw);
                bytes += integer(item, 'logical_bytes');
                if (table === 'events') {
                    events++;
                    if (integer(item, 'seq') !== events)
                        fail('event_sequence');
                }
            }
        if (integer(row, 'byte_usage') !== bytes || typeof body?.lastSeq !== 'number' || !Number.isSafeInteger(body.lastSeq) || BigInt(body.lastSeq) !== events)
            fail('group_accounting');
    }
    if (row.table === 'messages' && body?.contentId !== undefined) {
        if (typeof body.contentId !== 'string')
            fail('content');
        const content = one(reader, 'groups:content', 'contents', [body.contentId]);
        if (scalar(content, 'group_id') !== scalar(row, 'group_id'))
            fail('content_group');
    }
    if (row.table === 'operations' && body && ['published_message', 'published_message_unavailable'].includes(String(body.command))) {
        const result = groupsObject(body.result);
        if (body.applyState !== 'applied' || typeof result.messageId !== 'string' || typeof result.messageSeq !== 'number' || !Number.isSafeInteger(result.messageSeq) || result.messageSeq < 1)
            fail('anchor');
        const event = groupsObject(one(reader, 'groups:event', 'events', [scalar(row, 'group_id'), String(result.messageSeq)]).json.data_json), original = groupsObject(groupsObject(event.payload).message);
        if (event.kind !== 'message_sent' || original.groupId !== body.groupId || original.messageId !== result.messageId || messageDigest(original) !== body.requestHash)
            fail('anchor_event');
        const current = groupsObject(one(reader, 'groups:message', 'messages', [result.messageId]).json.data_json);
        if (current.groupId !== original.groupId || current.originalReceiverId !== undefined && current.originalReceiverId !== original.receiverId || messageDigest({ ...current, receiverId: current.originalReceiverId ?? current.receiverId }) !== body.requestHash)
            fail('anchor_message');
        if (body.command === 'published_message') {
            const facts = groupsObject(result.facts);
            capturedFields(facts, ['version', 'sourceSessionId', 'recipientSessionId', 'historyDigest', 'closure']);
            if (facts.version !== 1 || typeof facts.sourceSessionId !== 'string' || !facts.sourceSessionId || typeof facts.recipientSessionId !== 'string' || !facts.recipientSessionId || typeof facts.historyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(facts.historyDigest))
                fail('anchor_facts');
        }
        if (body.command === 'published_message_unavailable' && (current.bodyUnavailable !== true || current.preview !== 'FINAL_CONTENT_NOT_PERSISTED' || result.bodyUnavailable !== true))
            fail('anchor_unavailable');
    }
}
/** Complete internal capture declarations; neither these rows nor the final
 * digest are an authorization, source lock, read grant, or import capability. */
export function* iterateCapturedSQLiteGroupsSources(owner, token) {
    const facts = readProfileSourceCapture(owner, token), sources = [], hash = createHash('sha256').update('xiaok-captured-groups-stream-v1\0');
    const frame = (event) => { readProfileSourceCapture(owner, token); const raw = Buffer.from(JSON.stringify(event)); hash.update(String(raw.length) + '\0'); hash.update(raw); return event; };
    for (const item of facts.sources.filter(item => item.source.kind === 'sqlite-db' && item.source.snapshotFormat === 'multi-agent-groups-sqlite-v1').sort((a, b) => Buffer.compare(Buffer.from(a.source.sourceId), Buffer.from(b.source.sourceId)))) {
        const sourceId = item.source.sourceId, reader = openProfileSqliteReader(owner, token, sourceId), counts = [];
        try {
            const schema = readCapturedGroupsSchema(readProfileSqliteReaderSchema(reader), readProfileSqliteReaderUserVersion(reader));
            yield frame({ kind: 'source-start', sourceId, snapshotHash: item.snapshotHash, userVersion: schema.version });
            for (const table of [...schema.tables].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
                const query = (table === 'thread_bindings' ? schema.threadQuery : 'groups:' + table);
                let count = 0n;
                yield frame({ kind: 'table-start', sourceId, table, columns: METADATA_SESSION_QUERIES[query].columns });
                for (const raw of iterateProfileSqliteReaderRows(reader, query)) {
                    const row = readCapturedGroupsRow(table, raw);
                    relationships(reader, row);
                    const declared = declareCapturedGroupsRow(row);
                    count++;
                    yield frame({ kind: 'row', sourceId, table, rowid: row.rowid, ordinal: String(count), cells: row.cells, parsed: row.json, references: declared.references, unmapped: declared.unmapped, observationDeclarations: declared.observationDeclarations });
                }
                counts.push(Object.freeze({ table, count: String(count) }));
                yield frame({ kind: 'table-end', sourceId, table, count: String(count) });
            }
        }
        finally {
            closeProfileSqliteReader(reader);
        }
        readProfileSourceCapture(owner, token);
        const source = freezeCapturedData({ sourceId, snapshotHash: item.snapshotHash, tables: counts });
        sources.push(source);
        yield frame({ kind: 'source-end', ...source });
    }
    readProfileSourceCapture(owner, token);
    yield freezeCapturedData({ kind: 'complete', version: 1, sources, digest: hash.digest('hex') });
}
