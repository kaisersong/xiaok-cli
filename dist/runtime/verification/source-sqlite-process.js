import { KSWARM_STATE_QUERIES, KSWARM_STATE_COLUMNS } from './kswarm-state-source-schema.js';
import { metadataSessionRelationManifest } from './metadata-session-relation-manifest.js';
import { assertInstalledRootBrokerClient } from './root-broker-client.js';
import { isWriterLockSourceName } from './writer-lock-source-name.js';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { METADATA_SESSION_QUERIES } from './metadata-session-query-manifest.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { ARTIFACT_WORKSPACE_QUERIES } from './artifact-workspace-source-schema.js';
import { capturedSqliteEncoding, encodeCapturedSqliteCell } from './source-sqlite-cell.js';
const captures = new WeakMap();
const owners = new WeakMap();
function fields(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
    throw Error('source_sqlite_protocol'); }
function decimal(value, positive = false) { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n || positive && value === '0')
    throw Error('source_sqlite_identity'); }
/** This is a private native-process driver, not an authorization or full-set
 * issuer. The installed broker supplies its pinned helper and approved sources.
 * Only the full broker composition may turn actual captures into an import cap. */
export async function startSqliteSourceCustody(input) {
    const { executable, uid, signal } = input;
    if (!Number.isSafeInteger(uid) || uid < 1 || input.sources.length < 1 || input.sources.length > 32)
        throw Error('source_sqlite_arguments');
    const sources = input.sources.map(value => { fields(value, ['snapshotFormat', 'directory', 'database', 'sidecars']); if (!['session-sqlite-v1', 'loop-sqlite-v1', 'goal-sqlite-v1', 'writer-lock-sqlite-v1', 'codex-native-sqlite-v1', 'codex-routes-sqlite-v1', 'artifact-workspace-sqlite-v1', 'kswarm-state-sqlite-v1', 'multi-agent-groups-sqlite-v1'].includes(value.snapshotFormat))
        throw Error('source_sqlite_format'); fields(value.directory, ['canonicalPath', 'device', 'inode']); fields(value.database, ['basename', 'device', 'inode']); fields(value.sidecars, ['journal', 'wal', 'shm']); for (const part of [value.directory.device, value.database.device])
        decimal(part); for (const part of [value.directory.inode, value.database.inode])
        decimal(part, true); for (const part of Object.values(value.sidecars)) {
        if (part !== 'absent') {
            if (typeof part !== 'string' || part.split(':').length !== 2)
                throw Error('source_sqlite_identity');
            const [d, i] = part.split(':');
            decimal(d);
            decimal(i, true);
        }
    } if (typeof value.directory.canonicalPath !== 'string' || typeof value.database.basename !== 'string')
        throw Error('source_sqlite_identity'); if (value.snapshotFormat === 'writer-lock-sqlite-v1' && !isWriterLockSourceName(value.directory.canonicalPath, value.database.basename))
        throw Error('source_sqlite_lock_namespace'); return Object.freeze({ snapshotFormat: value.snapshotFormat, directory: Object.freeze({ ...value.directory }), database: Object.freeze({ ...value.database }), sidecars: Object.freeze({ ...value.sidecars }) }); });
    const args = [String(uid), ...sources.flatMap(s => [s.directory.canonicalPath, s.directory.device, s.directory.inode, s.database.basename, s.database.device, s.database.inode, s.sidecars.journal, s.sidecars.wal, s.sidecars.shm])];
    if (args.reduce((bytes, value) => bytes + Buffer.byteLength(value) + 1, 0) > 192 * 1024)
        throw Error('source_sqlite_arguments');
    signal.throwIfAborted();
    const child = spawn(executable, args, { cwd: '/', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, stdio: 'pipe' });
    let ended = false, closing = false, failure, buffer = Buffer.alloc(0), stderrBytes = 0, first, firstSeen = false, busy = false, closePromise;
    let waiter;
    let resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });
    const retained = [];
    const readers = new Set();
    function poison(error) { failure ??= error; if (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(failure);
        waiter = undefined;
    } if (!ended)
        child.kill('SIGKILL'); }
    function current() { if (failure)
        throw failure; if (ended || closing)
        throw Error('source_sqlite_closed'); signal.throwIfAborted(); }
    const abort = () => poison(Error('source_sqlite_aborted'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted)
        abort();
    child.on('error', () => poison(Error('source_sqlite_spawn')));
    child.stdin.on('error', () => poison(Error('source_sqlite_channel')));
    child.stderr.on('data', (bytes) => { stderrBytes += bytes.length; if (stderrBytes > 4096)
        poison(Error('source_sqlite_output_limit')); });
    child.stdout.on('data', (bytes) => { if (failure)
        return; if (buffer.length + bytes.length > 1024 ** 2) {
        poison(Error('source_sqlite_output_limit'));
        return;
    } buffer = Buffer.concat([buffer, bytes]); for (;;) {
        const at = buffer.indexOf(10);
        if (at < 0)
            break;
        let value;
        try {
            value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, at)));
        }
        catch {
            poison(Error('source_sqlite_protocol'));
            return;
        }
        buffer = buffer.subarray(at + 1);
        if (waiter) {
            firstSeen = true;
            const pending = waiter;
            waiter = undefined;
            clearTimeout(pending.timer);
            pending.resolve(value);
        }
        else if (!firstSeen) {
            firstSeen = true;
            first = value;
        }
        else {
            poison(Error('source_sqlite_unsolicited'));
            return;
        }
    } });
    child.on('close', () => { ended = true; signal.removeEventListener('abort', abort); if (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(failure ?? Error('source_sqlite_ended'));
        waiter = undefined;
    } resolveClosed(); });
    async function receive(command) { current(); if (waiter)
        throw Error('source_sqlite_concurrent'); if (!command && firstSeen) {
        const value = first;
        first = undefined;
        return value;
    } const answer = new Promise((resolve, reject) => { const timer = setTimeout(() => poison(Error('source_sqlite_timeout')), 10000); waiter = { resolve, reject, timer }; }); if (command)
        child.stdin.write(command + '\n'); return answer; }
    async function close() { if (closePromise)
        return closePromise; closing = true; closePromise = (async () => { if (!ended) {
        const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
        child.stdin.end('RELEASE\n');
        await closed;
        clearTimeout(timer);
    } if (buffer.length)
        failure ??= Error('source_sqlite_partial_frame'); for (const closeReader of readers)
        closeReader(); for (const bytes of retained)
        bytes.fill(0); retained.length = 0; })(); return closePromise; }
    let header;
    function parseHeader(value) { fields(value, ['state', 'count', 'pid', 'nonce', 'snapshots']); if (value.state !== 'held' || value.count !== sources.length || value.pid !== child.pid || typeof value.nonce !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.nonce) || !Array.isArray(value.snapshots) || value.snapshots.length !== sources.length)
        throw Error('source_sqlite_header'); value.snapshots.forEach((snapshot, index) => { fields(snapshot, ['index', 'pageSize', 'pageCount', 'physicalFiles']); if (!Array.isArray(snapshot.physicalFiles) || snapshot.physicalFiles.length < 1 || snapshot.physicalFiles.length > 4)
        throw Error('source_sqlite_header'); let previous = -1; for (const file of snapshot.physicalFiles) {
        fields(file, ['suffix', 'device', 'inode', 'byteLength']);
        const at = ['', '-journal', '-wal', '-shm'].indexOf(file.suffix);
        if (at < 0 || at <= previous || previous < 0 && at !== 0)
            throw Error('source_sqlite_header');
        previous = at;
        decimal(file.device);
        decimal(file.inode, true);
        decimal(file.byteLength);
        if (at === 0 && (file.device !== sources[index].database.device || file.inode !== sources[index].database.inode))
            throw Error('source_sqlite_identity');
        Object.freeze(file);
    } Object.freeze(snapshot.physicalFiles); const size = snapshot.pageSize, count = snapshot.pageCount; if (snapshot.index !== index || !Number.isSafeInteger(size) || size < 512 || size > 65536 || (size & (size - 1)) || !Number.isSafeInteger(count) || count < 1 || size * count > 128 * 1024 ** 2)
        throw Error('source_sqlite_header'); }); if (value.snapshots.reduce((n, s) => n + s.pageSize * s.pageCount, 0) > 128 * 1024 ** 2)
        throw Error('source_sqlite_total_limit'); return value; }
    try {
        header = parseHeader(await receive());
        firstSeen = true;
    }
    catch (error) {
        poison(error instanceof Error ? error : Error('source_sqlite_header'));
        await close();
        throw error;
    }
    async function check() { const answer = parseHeader(await receive('CHECK')); if (json(answer) !== json(header))
        throw Error('source_sqlite_changed'); current(); }
    let captured = false;
    const owner = Object.freeze({
        async checkCurrent() { current(); if (busy)
            throw Error('source_sqlite_concurrent'); busy = true; try {
            await check();
        }
        catch (error) {
            poison(error instanceof Error ? error : Error('source_sqlite_changed'));
            await close();
            throw error;
        }
        finally {
            busy = false;
        } },
        async capture(maximumBytes = 128 * 1024 ** 2) { current(); if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > 128 * 1024 ** 2)
            throw Error('source_sqlite_capture_limit'); if (busy || captured)
            throw Error('source_sqlite_capture_consumed'); busy = true; captured = true; try {
            if (header.snapshots.reduce((n, s) => n + s.pageSize * s.pageCount, 0) > maximumBytes)
                throw Error('source_sqlite_total_limit');
            const facts = [];
            for (const snapshot of header.snapshots) {
                const bytes = Buffer.alloc(snapshot.pageSize * snapshot.pageCount);
                retained.push(bytes);
                const hash = createHash('sha256');
                hash.update('xiaok-source-sqlite-pager-v1\0');
                hash.update(json({ pageSize: snapshot.pageSize, pageCount: snapshot.pageCount }));
                hash.update('\0');
                for (let pageNo = 1; pageNo <= snapshot.pageCount; pageNo++) {
                    const page = await receive('PAGE');
                    fields(page, ['state', 'index', 'pageNo', 'nonce', 'bytes']);
                    if (page.state !== 'page' || page.index !== snapshot.index || page.pageNo !== pageNo || page.nonce !== header.nonce || typeof page.bytes !== 'string' || page.bytes.length !== snapshot.pageSize * 2 || !/^[a-f0-9]+$/.test(page.bytes))
                        throw Error('source_sqlite_page');
                    const pageBytes = Buffer.from(page.bytes, 'hex');
                    hash.update(pageBytes);
                    pageBytes.copy(bytes, (pageNo - 1) * snapshot.pageSize);
                }
                facts.push(Object.freeze({ source: sources[snapshot.index], pageSize: snapshot.pageSize, pageCount: snapshot.pageCount, byteLength: snapshot.pageSize * snapshot.pageCount, physicalFiles: snapshot.physicalFiles, sha256: hash.digest('hex') }));
            }
            const end = await receive('PAGE');
            fields(end, ['state', 'nonce', 'count']);
            if (end.state !== 'snapshot-complete' || end.nonce !== header.nonce || end.count !== sources.length)
                throw Error('source_sqlite_incomplete');
            await check();
            const token = Object.freeze({});
            captures.set(token, { owner, facts: Object.freeze(facts), pages: Object.freeze([...retained]) });
            for (let index = 0; index < facts.length; index++)
                if (facts[index].source.snapshotFormat === 'writer-lock-sqlite-v1' && readSqliteSourceSchema(owner, token, index).length !== 0)
                    throw Error('source_sqlite_writer_lock_schema');
            return token;
        }
        catch (error) {
            poison(error instanceof Error ? error : Error('source_sqlite_capture'));
            await close();
            throw error;
        }
        finally {
            busy = false;
        } },
        close,
    });
    owners.set(owner, { current, readers });
    return owner;
}
export function readSqliteSourceCapture(owner, token) { const entry = owners.get(owner), capture = captures.get(token); if (!entry || !capture || capture.owner !== owner)
    throw Error('source_sqlite_capture_brand'); entry.current(); return capture.facts; }
/** Opens a parsing representation only. The captured hash always describes the
 * original pager bytes; changing WAL header flags here neither changes those
 * bytes nor creates a reviewed source identity. No database handle escapes. */
function openSnapshot(owner, token, index, integrityCopy = false) {
    const facts = readSqliteSourceCapture(owner, token), capture = captures.get(token);
    if (!Number.isSafeInteger(index) || index < 0 || index >= facts.length)
        throw Error('source_sqlite_index');
    if (owners.get(owner).readers.size)
        throw Error('source_sqlite_reader_busy');
    const original = capture.pages[index], fact = facts[index];
    if (original.length !== fact.byteLength || original.subarray(0, 16).toString('binary') !== 'SQLite format 3\0' || original[18] !== original[19] || ![1, 2].includes(original[18]))
        throw Error('source_sqlite_header');
    const size = original.readUInt16BE(16);
    if ((size === 1 ? 65536 : size) !== fact.pageSize)
        throw Error('source_sqlite_header');
    const bytes = Buffer.from(original);
    bytes[18] = bytes[19] = 1;
    let database;
    try {
        database = new Database(bytes, { readonly: !integrityCopy });
        database.pragma(integrityCopy ? 'query_only=OFF' : 'query_only=ON');
        database.pragma('trusted_schema=OFF');
        database.pragma('temp_store=MEMORY');
        if (database.readonly === integrityCopy || !database.memory || database.pragma('page_count', { simple: true }) !== fact.pageCount || database.pragma('page_size', { simple: true }) !== fact.pageSize)
            throw Error('source_sqlite_snapshot');
        const readers = owners.get(owner).readers;
        let closed = false, closeFailure;
        const iterators = new Set();
        const close = () => { if (closed) {
            if (closeFailure)
                throw closeFailure;
            return;
        } closed = true; const errors = closeFailure ? [closeFailure] : []; for (const iterator of iterators)
            try {
                iterator.return?.();
            }
            catch (error) {
                errors.push(error);
            } iterators.clear(); try {
            if (database.open)
                database.close();
        }
        catch (error) {
            errors.push(error);
        } if (errors.length) {
            closeFailure = new AggregateError(errors, 'source_sqlite_reader_close');
            throw closeFailure;
        } bytes.fill(0); readers.delete(close); };
        readers.add(close);
        return { database, close, assertUsable() { if (closeFailure)
                throw closeFailure; if (closed)
                throw Error('source_sqlite_reader_closed'); }, setIterator(value) { if (closeFailure)
                throw closeFailure; iterators.add(value); }, closeIterator(value) { try {
                value.return?.();
                iterators.delete(value);
            }
            catch (error) {
                closeFailure ??= new AggregateError([error], 'source_sqlite_reader_close');
                throw closeFailure;
            } } };
    }
    catch (error) {
        try {
            if (database?.open)
                database.close();
        }
        catch (cleanup) {
            const failure = new AggregateError([error, cleanup], 'source_sqlite_reader_close');
            owners.get(owner).readers.add(() => { if (database?.open || bytes.byteLength)
                throw failure; });
            throw failure;
        }
        bytes.fill(0);
        throw error;
    }
}
export function readSqliteSourceSchema(owner, token, index) {
    const snapshot = openSnapshot(owner, token, index);
    try {
        const rows = snapshot.database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
        readSqliteSourceCapture(owner, token);
        return Object.freeze(rows.map(row => Object.freeze(row)));
    }
    finally {
        snapshot.close();
    }
}
/** Fixed integrity checks on the disposable captured copy, never source SQL. */
function assertSnapshotIntegrity(snapshot) {
    const database = snapshot.database, integrity = database.prepare('PRAGMA integrity_check').iterate();
    snapshot.setIterator(integrity);
    try {
        const first = integrity.next();
        if (first.done || JSON.stringify(first.value) !== JSON.stringify({ integrity_check: 'ok' }) || !integrity.next().done)
            throw Error('source_sqlite_integrity');
    }
    finally {
        snapshot.closeIterator(integrity);
    }
    const foreign = database.prepare('PRAGMA foreign_key_check').iterate();
    snapshot.setIterator(foreign);
    try {
        if (!foreign.next().done)
            throw Error('source_sqlite_foreign_key_integrity');
    }
    finally {
        snapshot.closeIterator(foreign);
    }
}
export function assertSqliteSourceIntegrity(owner, token, index) {
    const facts = readSqliteSourceCapture(owner, token);
    if (!Number.isSafeInteger(index) || index < 0 || !facts[index] || !['codex-native-sqlite-v1', 'codex-routes-sqlite-v1', 'artifact-workspace-sqlite-v1', 'kswarm-state-sqlite-v1'].includes(facts[index].source.snapshotFormat))
        throw Error('source_sqlite_query_format');
    const snapshot = openSnapshot(owner, token, index);
    try {
        assertSnapshotIntegrity(snapshot);
        readSqliteSourceCapture(owner, token);
    }
    finally {
        snapshot.close();
    }
}
/** Separate lossless ABI; existing number-based readers remain unchanged. */
export function* readSqliteSourceLosslessRows(owner, token, index, queryId) {
    if (typeof queryId !== 'string')
        throw Error('source_sqlite_query');
    const isKSwarm = Object.hasOwn(KSWARM_STATE_QUERIES, queryId);
    if (!isKSwarm && !Object.hasOwn(ARTIFACT_WORKSPACE_QUERIES, queryId))
        throw Error('source_sqlite_query');
    const facts = readSqliteSourceCapture(owner, token), format = isKSwarm ? 'kswarm-state-sqlite-v1' : 'artifact-workspace-sqlite-v1';
    if (!Number.isSafeInteger(index) || index < 0 || facts[index]?.source.snapshotFormat !== format)
        throw Error('source_sqlite_query_format');
    const query = isKSwarm ? KSWARM_STATE_QUERIES[queryId] : ARTIFACT_WORKSPACE_QUERIES[queryId], quote = (name) => '"' + name.replaceAll('"', '""') + '"', snapshot = openSnapshot(owner, token, index);
    try {
        const definition = snapshot.database.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(query.table);
        if (!definition || definition.type !== 'table' || typeof definition.sql !== 'string' || !/^CREATE\s+TABLE\b/i.test(definition.sql) || /WITHOUT\s+ROWID/i.test(definition.sql))
            throw Error('source_sqlite_query_table');
        const columns = snapshot.database.prepare('PRAGMA table_xinfo(' + quote(query.table) + ')').all();
        if (columns.length !== query.columns.length || columns.some((c, i) => c.name !== query.columns[i] || c.hidden !== 0))
            throw Error('source_sqlite_query_columns');
        if (isKSwarm) {
            const expected = KSWARM_STATE_COLUMNS[queryId];
            if (columns.some((c, i) => { const actual = c, want = expected[i]; return Object.keys(actual).length !== Object.keys(want).length || Object.entries(want).some(([key, value]) => actual[key] !== value); }))
                throw Error('source_sqlite_query_columns');
        }
        const encoding = capturedSqliteEncoding(snapshot.database.pragma('encoding', { simple: true }));
        const projection = query.columns.flatMap((name, i) => [quote(name) + ' AS v' + i, 'typeof(' + quote(name) + ') AS t' + i, 'CASE WHEN typeof(' + quote(name) + ")='text' THEN CAST(" + quote(name) + ' AS BLOB) END AS b' + i]);
        const rows = snapshot.database.prepare('SELECT rowid AS original_rowid,' + projection.join(',') + ' FROM ' + quote(query.table) + ' ORDER BY rowid').safeIntegers(true).iterate();
        snapshot.setIterator(rows);
        for (;;) {
            readSqliteSourceCapture(owner, token);
            const next = rows.next();
            if (next.done)
                break;
            const raw = next.value;
            if (typeof raw.original_rowid !== 'bigint')
                throw Error('source_sqlite_rowid');
            const record = {};
            query.columns.forEach((name, i) => { record[name] = encodeCapturedSqliteCell(raw['t' + i], raw['v' + i], raw['b' + i], encoding); });
            readSqliteSourceCapture(owner, token);
            yield Object.freeze({ rowid: String(raw.original_rowid), record: Object.freeze(record) });
        }
        readSqliteSourceCapture(owner, token);
    }
    finally {
        snapshot.close();
    }
}
/** Fixed original columns only; never caller SQL or a user-defined view. Layout
 * completeness and all-source/session closure are the collector's separate job. */
export function* readSqliteSourceRows(owner, token, index, queryId) {
    if (typeof queryId !== 'string' || !Object.hasOwn(METADATA_SESSION_QUERIES, queryId))
        throw Error('source_sqlite_query');
    const facts = readSqliteSourceCapture(owner, token);
    if (!Number.isSafeInteger(index) || index < 0 || index >= facts.length)
        throw Error('source_sqlite_index');
    const component = queryId.split(':')[0];
    const formats = { goal: 'goal-sqlite-v1', session: 'session-sqlite-v1', loop: 'loop-sqlite-v1', completion: 'loop-sqlite-v1', artifactScanner: 'loop-sqlite-v1', healthScanner: 'loop-sqlite-v1', 'codex-native': 'codex-native-sqlite-v1', 'codex-routes': 'codex-routes-sqlite-v1' };
    if (!Object.hasOwn(formats, component))
        throw Error('source_sqlite_query_format');
    const expectedFormat = formats[component];
    if (facts[index].source.snapshotFormat !== expectedFormat)
        throw Error('source_sqlite_query_format');
    const query = METADATA_SESSION_QUERIES[queryId], quote = (name) => '"' + name.replaceAll('"', '""') + '"', snapshot = openSnapshot(owner, token, index);
    try {
        const definition = snapshot.database.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(query.table);
        const standaloneFts = queryId === 'session:session_messages_fts';
        const ftsSql = 'CREATE VIRTUAL TABLE session_messages_fts USING fts5( session_id UNINDEXED, message_index UNINDEXED, text_content )';
        if (!definition || definition.type !== 'table' || typeof definition.sql !== 'string' || (standaloneFts ? definition.sql.replace(/\s+/g, ' ').trim() !== ftsSql : !/^CREATE\s+TABLE\b/i.test(definition.sql)))
            throw Error('source_sqlite_query_table');
        const columns = snapshot.database.pragma('table_xinfo(' + quote(query.table) + ')');
        const expectedColumns = standaloneFts ? ['session_id', 'message_index', 'text_content', 'session_messages_fts', 'rank'] : query.columns;
        // Original Loop ADD COLUMN migrations retain every fixed column but append
        // it in a different physical order. The SELECT remains in manifest order.
        const loopColumns = ['loop', 'completion', 'artifactScanner', 'healthScanner'].includes(component);
        const invalidColumns = loopColumns
            ? columns.some(column => !expectedColumns.includes(column.name) || column.hidden !== 0) || new Set(columns.map(column => column.name)).size !== expectedColumns.length
            : columns.some((column, i) => column.name !== expectedColumns[i] || column.hidden !== (standaloneFts && i >= 3 ? 1 : 0));
        if (columns.length !== expectedColumns.length || invalidColumns)
            throw Error('source_sqlite_query_columns');
        const rows = snapshot.database.prepare('SELECT ' + query.columns.map(quote).join(',') + ' FROM ' + quote(query.table)).iterate();
        snapshot.setIterator(rows);
        for (;;) {
            readSqliteSourceCapture(owner, token);
            const next = rows.next();
            if (next.done)
                break;
            yield Object.freeze(next.value);
        }
        readSqliteSourceCapture(owner, token);
    }
    finally {
        snapshot.close();
    }
}
/** Fixed built-in FTS operation on a disposable parsing copy only. The original
 * captured pages and held source never receive a write and no SQL port escapes. */
export function assertSqliteSessionFtsIntegrity(owner, token, index) {
    const facts = readSqliteSourceCapture(owner, token);
    if (!Number.isSafeInteger(index) || index < 0 || index >= facts.length || facts[index].source.snapshotFormat !== 'session-sqlite-v1')
        throw Error('source_sqlite_query_format');
    const snapshot = openSnapshot(owner, token, index, true);
    try {
        const expected = {
            session_messages_fts: 'CREATE VIRTUAL TABLE session_messages_fts USING fts5( session_id UNINDEXED, message_index UNINDEXED, text_content )',
            session_messages_fts_config: "CREATE TABLE 'session_messages_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID",
            session_messages_fts_content: "CREATE TABLE 'session_messages_fts_content'(id INTEGER PRIMARY KEY, c0, c1, c2)",
            session_messages_fts_data: "CREATE TABLE 'session_messages_fts_data'(id INTEGER PRIMARY KEY, block BLOB)",
            session_messages_fts_docsize: "CREATE TABLE 'session_messages_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)",
            session_messages_fts_idx: "CREATE TABLE 'session_messages_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID",
        };
        for (const [name, sql] of Object.entries(expected)) {
            const row = snapshot.database.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(name);
            if (!row || row.type !== 'table' || typeof row.sql !== 'string' || row.sql.replace(/\s+/g, ' ').trim() !== sql)
                throw Error('source_sqlite_fts_schema');
        }
        snapshot.database.exec("INSERT INTO session_messages_fts(session_messages_fts) VALUES('integrity-check')");
        readSqliteSourceCapture(owner, token);
    }
    finally {
        snapshot.close();
    }
}
/** Fixed original pager export for the installed root transport. It exposes no
 * SQL or mutable database and remains bound to the actual held capture. */
export function readSqliteSourcePage(owner, token, index, pageNo) {
    const facts = readSqliteSourceCapture(owner, token), fact = facts[index];
    if (!Number.isSafeInteger(index) || !fact || !Number.isSafeInteger(pageNo) || pageNo < 1 || pageNo > fact.pageCount)
        throw Error('source_sqlite_page_range');
    const capture = captures.get(token);
    return Buffer.from(capture.pages[index].subarray((pageNo - 1) * fact.pageSize, pageNo * fact.pageSize));
}
/** Receives a SQL snapshot only through the actual installed broker instance.
 * There is intentionally no caller bytes/facts/callback import overload. */
const installedImports = new WeakMap();
export async function captureInstalledSqliteSource(lifetime, broker, handle, sourceId, signal) {
    assertInstalledRootBrokerClient(broker, lifetime);
    broker.describeProfileCapture(handle);
    let imported = installedImports.get(handle);
    if (!imported) {
        imported = new Set();
        installedImports.set(handle, imported);
    }
    if (imported.has(sourceId))
        throw Error('source_sqlite_remote_consumed');
    imported.add(sourceId);
    const manifest = await broker.loadProfileCaptureManifest(handle, signal), row = manifest.databases.find(r => r.sourceId === sourceId);
    if (!row)
        throw Error('source_sqlite_remote_source');
    const fact = row.capture, bytes = Buffer.alloc(fact.byteLength), readers = new Set();
    let closed = false, failure;
    function current() { if (failure)
        throw failure; if (closed)
        throw Error('source_sqlite_closed'); signal.throwIfAborted(); assertInstalledRootBrokerClient(broker, lifetime); broker.describeProfileCapture(handle); }
    const owner = Object.freeze({ async checkCurrent() { try {
            current();
            await broker.checkProfileCapture(handle, signal);
            current();
        }
        catch (error) {
            failure = error;
            throw error;
        } }, async close() { if (closed)
            return; closed = true; try {
            for (const closeReader of readers)
                closeReader();
        }
        finally {
            bytes.fill(0);
        } } });
    try {
        current();
        const hash = createHash('sha256').update('xiaok-source-sqlite-pager-v1\0').update(json({ pageSize: fact.pageSize, pageCount: fact.pageCount })).update('\0');
        for (let pageNo = 1; pageNo <= fact.pageCount; pageNo++) {
            const page = await broker.readProfileSqlitePage(handle, sourceId, pageNo, signal);
            try {
                current();
                if (page.length !== fact.pageSize)
                    throw Error('source_sqlite_remote_page');
                hash.update(page);
                page.copy(bytes, (pageNo - 1) * fact.pageSize);
            }
            finally {
                page.fill(0);
            }
        }
        if (hash.digest('hex') !== fact.sha256)
            throw Error('source_sqlite_remote_hash');
        await owner.checkCurrent();
        const token = Object.freeze({});
        owners.set(owner, { current, readers });
        captures.set(token, { owner, facts: Object.freeze([fact]), pages: Object.freeze([bytes]) });
        if (fact.source.snapshotFormat === 'writer-lock-sqlite-v1' && readSqliteSourceSchema(owner, token, 0).length !== 0)
            throw Error('source_sqlite_writer_lock_schema');
        return Object.freeze({ owner, token });
    }
    catch (error) {
        await owner.close();
        throw error;
    }
}
const sqliteReaders = new WeakMap();
function sqliteReader(reader) { const found = sqliteReaders.get(reader); if (!found)
    throw Error('source_sqlite_reader_brand'); if (found.closed)
    throw Error('source_sqlite_reader_closed'); readSqliteSourceCapture(found.owner, found.token); found.snapshot.assertUsable(); return found; }
/** Original capture and fixed catalogue only; no caller database or SQL port. */
export function openSqliteSourceReader(owner, token, index) {
    const facts = readSqliteSourceCapture(owner, token);
    if (!Number.isSafeInteger(index) || index < 0 || !['loop-sqlite-v1', 'multi-agent-groups-sqlite-v1'].includes(facts[index]?.source.snapshotFormat ?? ''))
        throw Error('source_sqlite_query_format');
    const snapshot = openSnapshot(owner, token, index);
    try {
        assertSnapshotIntegrity(snapshot);
        snapshot.database.function('__captured_utf8_sort', { deterministic: true }, (value) => { if (typeof value !== 'string')
            throw Error('source_sqlite_sort_type'); return Buffer.from(value, 'utf8'); });
        const encoding = capturedSqliteEncoding(snapshot.database.pragma('encoding', { simple: true }));
        readSqliteSourceCapture(owner, token);
        const reader = Object.freeze({});
        sqliteReaders.set(reader, { owner, token, snapshot, encoding, format: facts[index].source.snapshotFormat, closed: false, active: new Set(), queries: new Map(), statements: new Map() });
        return reader;
    }
    catch (error) {
        snapshot.close();
        throw error;
    }
}
export function closeSqliteSourceReader(reader) { const found = sqliteReaders.get(reader); if (!found)
    throw Error('source_sqlite_reader_brand'); if (found.closed) {
    if (found.failure)
        throw found.failure;
    return;
} found.closed = true; try {
    found.snapshot.close();
    found.active.clear();
    found.queries.clear();
    found.statements.clear();
}
catch (error) {
    found.failure = error;
    throw error;
} }
/** Schema facts from the very same parser connection used for all row/relationship
 * checks. No second parsing copy or mutable handle is returned. */
export function readSqliteSourceReaderSchema(reader) {
    const found = sqliteReader(reader);
    let statement = found.statements.get('schema:sqlite_master');
    if (!statement) {
        statement = found.snapshot.database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name');
        found.statements.set('schema:sqlite_master', statement);
    }
    const rows = statement.all();
    const result = Object.freeze(rows.map(row => Object.freeze({ ...row })));
    sqliteReader(reader);
    return result;
}
/** Fixed metadata read on the original parser connection; not a schema capability. */
export function readSqliteSourceReaderUserVersion(reader) {
    const found = sqliteReader(reader);
    let statement = found.statements.get('metadata:user-version');
    if (!statement) {
        statement = found.snapshot.database.prepare('PRAGMA user_version');
        found.statements.set('metadata:user-version', statement);
    }
    const row = statement.get();
    if (!row || typeof row.user_version !== 'number' || !Number.isInteger(row.user_version) || row.user_version < -2147483648 || row.user_version > 2147483647)
        throw Error('source_sqlite_user_version');
    sqliteReader(reader);
    return row.user_version;
}
function fixedReaderQuery(reader, queryId) {
    const found = sqliteReader(reader);
    if (typeof queryId !== 'string' || !Object.hasOwn(METADATA_SESSION_QUERIES, queryId) || !(found.format === 'multi-agent-groups-sqlite-v1' ? ['groups'] : ['loop', 'completion', 'artifactScanner', 'healthScanner']).includes(queryId.split(':')[0]))
        throw Error('source_sqlite_query');
    const cached = found.queries.get(queryId);
    if (cached)
        return { found, ...cached };
    const query = METADATA_SESSION_QUERIES[queryId], quote = (name) => '"' + name.replaceAll('"', '""') + '"', db = found.snapshot.database;
    const definition = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(query.table);
    if (!definition || definition.type !== 'table' || typeof definition.sql !== 'string' || !/^CREATE\s+TABLE\b/i.test(definition.sql) || /WITHOUT\s+ROWID/i.test(definition.sql))
        throw Error('source_sqlite_query_table');
    const columns = db.prepare('PRAGMA table_xinfo(' + quote(query.table) + ')').all(), expected = query.columns;
    if (columns.length !== expected.length || columns.some(c => !expected.includes(c.name) || c.hidden !== 0) || new Set(columns.map(c => c.name)).size !== expected.length || columns.some(c => ['rowid', '_rowid_', 'oid'].includes(c.name.toLowerCase())))
        throw Error('source_sqlite_query_columns');
    const primary = columns.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
    const projection = query.columns.flatMap((name, i) => [quote(name) + ' AS v' + i, 'typeof(' + quote(name) + ') AS t' + i, 'CASE WHEN typeof(' + quote(name) + ")='text' THEN CAST(" + quote(name) + ' AS BLOB) END AS b' + i]);
    const select = 'SELECT rowid AS original_rowid,' + projection.join(',') + ' FROM ' + quote(query.table), cachedQuery = { query, quote, primary, select, lookup: db.prepare(select + ' WHERE rowid=?').safeIntegers(true) };
    found.queries.set(queryId, cachedQuery);
    return { found, ...cachedQuery };
}
function readerRow(found, columns, value) { const raw = value; if (typeof raw.original_rowid !== 'bigint')
    throw Error('source_sqlite_rowid'); const record = {}; columns.forEach((name, i) => { record[name] = encodeCapturedSqliteCell(raw['t' + i], raw['v' + i], raw['b' + i], found.encoding); }); return Object.freeze({ rowid: String(raw.original_rowid), record: Object.freeze(record) }); }
function* iterateFixedReader(reader, queryId, slot, relation, keys = []) {
    const { found, query, quote, primary, lookup } = fixedReaderQuery(reader, queryId);
    if (found.active.has(slot))
        throw Error('source_sqlite_reader_busy');
    found.active.add(slot);
    let rows;
    try {
        if (relation && (relation.whereEqual.length !== keys.length || relation.boundKeyTypes.length !== keys.length || relation.whereEqual.some(c => !query.columns.includes(c)) || relation.orderBy.some(c => !query.columns.includes(c))))
            throw Error('source_sqlite_relation');
        const where = relation ? ' WHERE ' + relation.whereEqual.map(c => quote(c) + ' COLLATE BINARY=?').join(' AND ') : '', order = (relation ? relation.orderBy : primary).flatMap(c => ["CASE typeof(" + quote(c) + ") WHEN 'null' THEN 0 WHEN 'integer' THEN 1 WHEN 'real' THEN 1 WHEN 'text' THEN 2 WHEN 'blob' THEN 3 ELSE 4 END", "CASE WHEN typeof(" + quote(c) + ")='text' THEN __captured_utf8_sort(" + quote(c) + ') ELSE ' + quote(c) + ' END']).concat('rowid');
        const readRow = (value) => { const id = value.original_rowid; if (typeof id !== 'bigint')
            throw Error('source_sqlite_rowid'); const raw = lookup.get(id); if (!raw)
            throw Error('source_sqlite_row_missing'); return readerRow(found, query.columns, raw); };
        const statementKey = relation ? 'relation:' + slot : 'full:' + queryId;
        let statement = found.statements.get(statementKey);
        if (!statement) {
            statement = found.snapshot.database.prepare('SELECT rowid AS original_rowid FROM ' + quote(query.table) + where + ' ORDER BY ' + order.join(',')).safeIntegers(true);
            found.statements.set(statementKey, statement);
        }
        rows = statement.iterate(...keys);
        found.snapshot.setIterator(rows);
        if (relation?.cardinality === 'zero-or-one') {
            sqliteReader(reader);
            const first = rows.next();
            if (first.done) {
                sqliteReader(reader);
                return;
            }
            const row = readRow(first.value);
            if (!rows.next().done)
                throw Error('source_sqlite_relation_cardinality');
            found.snapshot.closeIterator(rows);
            rows = undefined;
            sqliteReader(reader);
            yield row;
            sqliteReader(reader);
            return;
        }
        for (;;) {
            sqliteReader(reader);
            const next = rows.next();
            if (next.done)
                break;
            const row = readRow(next.value);
            sqliteReader(reader);
            yield row;
            sqliteReader(reader);
        }
        sqliteReader(reader);
    }
    finally {
        try {
            if (rows)
                found.snapshot.closeIterator(rows);
        }
        finally {
            found.active.delete(slot);
        }
    }
}
export function* iterateSqliteSourceReaderRows(reader, queryId) { yield* iterateFixedReader(reader, queryId, 'full'); }
export function* iterateSqliteSourceReaderRelation(reader, relationId, boundKeys) {
    if (typeof relationId !== 'string' || !Object.hasOwn(metadataSessionRelationManifest, relationId) || !Array.isArray(boundKeys) || boundKeys.some(key => typeof key !== 'string'))
        throw Error('source_sqlite_relation');
    const relation = metadataSessionRelationManifest[relationId];
    yield* iterateFixedReader(reader, relation.queryId, relationId, relation, [...boundKeys]);
}
/** Private factual occupancy only; this does not read source bytes or grant use. */
export function hasSqliteSourceParser(owner, token) { const actual = owners.get(owner), capture = captures.get(token); if (!actual || !capture || capture.owner !== owner)
    throw Error('source_sqlite_capture_brand'); return actual.readers.size > 0; }
