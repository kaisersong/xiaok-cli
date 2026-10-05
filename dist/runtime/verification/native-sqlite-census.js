import { isDeepStrictEqual } from 'node:util';
import { canonicalVerificationJson as json } from './protocol.js';
import { freezeCapturedData } from './captured-source-json.js';
import { capturedSqliteEncoding, encodeCapturedSqliteCell } from './source-sqlite-cell.js';
const inventoryTables = ['verification_profiles', 'verification_registered_owners', 'verification_registered_invocations', 'owner_enrollment_invocation_receipts', 'owner_enrollment_goal_sessions', 'owner_enrollment_intents', 'owner_enrollment_loop_subjects', 'owner_enrollment_intent_contracts', 'owner_enrollment_kswarm_subjects', 'verification_storage_features', 'owner_enrollment_challenges', 'owner_enrollment_requests'];
const scopedQueries = { owner: { table: 'verification_owners', where: 'owner_key' }, obligations: { table: 'mandatory_observation_checks', where: 'owner_key', order: 'obligation_id' }, dependencies: { table: 'verification_owner_dependencies', where: 'parent_key', order: 'child_key' }, registered: { table: 'verification_registered_owners', where: 'owner_key' }, profile: { table: 'verification_profiles', where: 'profile_id' }, invocations: { table: 'verification_registered_invocations', where: 'owner_key', order: 'invocation_json' }, receipts: { table: 'owner_enrollment_invocation_receipts', where: 'owner_key', order: 'invocation_json' }, subject: { table: 'owner_enrollment_kswarm_subjects', where: 'owner_key' }, storageFeature: { table: 'verification_storage_features', where: 'feature' } };
const producerTables = new Set([...inventoryTables, ...Object.values(scopedQueries).map(query => query.table)]);
const asciiName = (name) => name.replace(/[A-Z]/g, character => character.toLowerCase());
/** Fixed native producer namespaces cannot resolve to virtual modules or computed data. */
export function assertNativeSqliteProducerTableKinds(database) {
    if (arguments.length !== 1)
        throw Error('native_sqlite_census_query');
    const modules = database.pragma('module_list');
    if (modules.some(row => typeof row.name === 'string' && producerTables.has(asciiName(row.name))))
        throw Error('native_sqlite_census_schema');
    const tables = database.pragma('main.table_list');
    if (tables.some(row => row.schema === 'main' && typeof row.name === 'string' && producerTables.has(asciiName(row.name)) && row.type !== 'table'))
        throw Error('native_sqlite_census_schema');
}
/** Call after the producer kind guard, before a semantic SELECT. Missing tables remain absent. */
export function assertNativeSqliteStoredProducerColumns(database, table) {
    if (arguments.length !== 2 || !producerTables.has(table))
        throw Error('native_sqlite_census_query');
    const columns = database.prepare('PRAGMA main.table_xinfo(' + quote(table) + ')').all();
    if (columns.some(column => column.hidden !== 0))
        throw Error('native_sqlite_census_schema');
}
const issuedFrames = new WeakSet();
function issued(frame) { issuedFrames.add(frame); return frame; }
/** Pure encoding of already-issued immutable facts, never an authority. */
export function canonicalNativeCensusPopulation(frames) {
    if (arguments.length !== 1 || !Array.isArray(frames))
        throw Error('native_sqlite_census_frame');
    const captured = [];
    for (const frame of frames) {
        if (!frame || typeof frame !== 'object' || !issuedFrames.has(frame))
            throw Error('native_sqlite_census_frame');
        captured.push(frame);
    }
    // Only descendants of exact privately issued, deeply frozen frames enter
    // this encoder. The public protocol continues to reject arbitrary accessors.
    const fragments = new WeakMap();
    const encode = (value) => {
        if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value))
            return JSON.stringify(value);
        if (!value || typeof value !== 'object')
            throw Error('native_sqlite_census_frame');
        let fragment = fragments.get(value);
        if (fragment !== undefined)
            return fragment;
        fragment = Array.isArray(value) ? '[' + value.map(encode).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + encode(Reflect.get(value, key))).join(',') + '}';
        fragments.set(value, fragment);
        return fragment;
    };
    return '[' + captured.map(encode).join(',') + ']';
}
function prepare(database, sql, statements) { let statement = statements.get(sql); if (!statement) {
    statement = database.prepare(sql);
    statements.set(sql, statement);
} return statement; }
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
function semantic(cell) {
    if (cell.type === 'null')
        return null;
    if (cell.type === 'text')
        return cell.value;
    if (cell.type === 'integer') {
        const value = BigInt(cell.value);
        return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : cell;
    }
    if (cell.type === 'real') {
        const value = Buffer.from(cell.value, 'hex').readDoubleBE();
        return Number.isFinite(value) ? value : cell;
    }
    return cell;
}
// SQL fragments/field lists are private. Only fixed query names cross this
// internal read boundary; no parser, callbacks or authority can be substituted.
function rows(database, encoding, columns, from, parameters, order = '', anchor, statements = new Map()) {
    const scalar = anchor ? "(SELECT sql FROM main.sqlite_master WHERE type='table' AND name=?)" : undefined;
    const assertAnchor = () => { if (anchor) {
        const current = rows(database, encoding, ['sql'], "main.sqlite_master WHERE type='table' AND name=?", [anchor.table], '', undefined, statements);
        if (current.length !== 1 || json(current[0].cells.sql) !== json(anchor.sql))
            throw Error('native_sqlite_census_changed');
    } };
    assertAnchor();
    const projection = columns.flatMap(name => [quote(name), 'typeof(' + quote(name) + ')', 'CAST(' + quote(name) + ' AS BLOB)']).concat(scalar ? [scalar, 'typeof(' + scalar + ')', 'CAST(' + scalar + ' AS BLOB)'] : []).join(',');
    const statement = prepare(database, 'SELECT ' + projection + ' FROM ' + from + (order ? ' ORDER BY ' + order : ''), statements);
    const values = statement.raw(true).safeIntegers(true).all(...(anchor ? [anchor.table, anchor.table, anchor.table, ...parameters] : parameters));
    if (anchor) {
        for (const value of values) {
            const i = columns.length * 3, actual = encodeCapturedSqliteCell(value[i + 1], value[i], value[i + 2], encoding);
            if (json(actual) !== json(anchor.sql))
                throw Error('native_sqlite_census_changed');
        }
        assertAnchor();
    }
    return values.map(value => { const cellRow = Object.fromEntries(columns.map((name, i) => [name, encodeCapturedSqliteCell(value[i * 3 + 1], value[i * 3], value[i * 3 + 2], encoding)])); return { cells: cellRow, semantic: Object.fromEntries(Object.entries(cellRow).map(([name, cell]) => [name, semantic(cell)])) }; });
}
function stamp(database, statements) { return json({ schema: database.pragma('main.schema_version', { simple: true }), changes: String(prepare(database, 'SELECT total_changes() AS n', statements).safeIntegers(true).get().n) }); }
function createContext(database) {
    assertNativeSqliteProducerTableKinds(database);
    const statements = new Map(), initial = stamp(database, statements), encoding = capturedSqliteEncoding(database.pragma('encoding', { simple: true }));
    const master = rows(database, encoding, ['type', 'name', 'tbl_name', 'sql'], 'main.sqlite_master', [], 'type,name', undefined, statements);
    const masterCells = freezeCapturedData(master.map(row => row.cells));
    const schemaError = () => { throw Error('native_sqlite_census_schema'); };
    const asciiFold = (value) => value.replace(/[A-Z]/g, char => char.toLowerCase());
    const names = new Set();
    for (const { semantic: row } of master) {
        if (typeof row.type !== 'string' || !['table', 'index', 'trigger', 'view'].includes(row.type) || typeof row.name !== 'string' || !row.name || typeof row.tbl_name !== 'string' || !row.tbl_name || (row.sql !== null && typeof row.sql !== 'string'))
            schemaError();
        const name = row.name, type = row.type, tblName = row.tbl_name;
        const key = json([type === 'trigger' ? 'trigger' : 'schema', asciiFold(name)]);
        if (names.has(key))
            schemaError();
        names.add(key);
        if ((type === 'table' || type === 'view') && name !== tblName)
            schemaError();
    }
    const indexCache = new Map();
    const indices = (tableName) => {
        let result = indexCache.get(tableName);
        if (!result) {
            result = rows(database, encoding, ['name', 'origin'], 'pragma_index_list(?,?)', [tableName, 'main'], '', undefined, statements);
            indexCache.set(tableName, result);
        }
        return result;
    };
    for (const { semantic: row } of master) {
        if (row.sql === null) {
            const name = row.name, tblName = row.tbl_name;
            if (row.type !== 'index' || !name.startsWith('sqlite_autoindex_' + tblName + '_') || indices(tblName).filter(index => index.semantic.name === name && ['pk', 'u'].includes(index.semantic.origin)).length !== 1)
                schemaError();
        }
    }
    return { database, encoding, master, masterCells, indices, schemaError, initial, statements };
}
function finish(context) {
    const { database, encoding, masterCells, initial, statements } = context;
    if (stamp(database, statements) !== initial)
        throw Error('native_sqlite_census_changed');
    const current = rows(database, encoding, ['type', 'name', 'tbl_name', 'sql'], 'main.sqlite_master', [], 'type,name', undefined, statements);
    if (!isDeepStrictEqual(current.map(row => row.cells), masterCells) || stamp(database, statements) !== initial)
        throw Error('native_sqlite_census_changed');
}
function census(context, query, argument) {
    const { database, encoding, master, masterCells, indices, schemaError, statements } = context;
    const scoped = Object.hasOwn(scopedQueries, query) ? scopedQueries[query] : undefined;
    const table = scoped?.table ?? query;
    const schemas = master.filter(row => row.semantic.name === table || row.semantic.tbl_name === table);
    if (!schemas.length) {
        const actual = rows(database, encoding, ['name'], 'pragma_table_xinfo(?,?)', [table, 'main'], '', undefined, statements);
        if (actual.length)
            schemaError();
        return issued(Object.freeze({ table, present: false, masterCells }));
    }
    if (schemas.filter(row => row.semantic.type === 'table' && row.semantic.name === table && row.semantic.tbl_name === table && typeof row.semantic.sql === 'string').length !== 1)
        schemaError();
    for (const { semantic: row } of schemas) {
        if (row.tbl_name !== table || (row.type !== 'table' && !['index', 'trigger'].includes(row.type)))
            schemaError();
    }
    for (const index of indices(table)) {
        const matches = master.filter(row => row.semantic.type === 'index' && row.semantic.name === index.semantic.name && row.semantic.tbl_name === table);
        if (matches.length !== 1)
            schemaError();
    }
    const primary = schemas.find(row => row.semantic.type === 'table' && row.semantic.name === table);
    const anchor = { table, sql: primary.cells.sql };
    const metadata = rows(database, encoding, ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'], 'pragma_table_xinfo(?,?)', [table, 'main'], 'cid', anchor, statements);
    if (metadata.some(column => column.semantic.hidden !== 0))
        schemaError();
    const columns = metadata.map(row => { if (typeof row.semantic.name !== 'string' || !row.semantic.name)
        throw Error('native_sqlite_census_column'); return row.semantic.name; });
    if (!columns.length)
        throw Error('native_sqlite_census_column');
    let data = rows(database, encoding, columns, 'main.' + quote(table) + (scoped ? ' WHERE ' + quote(scoped.where) + '=?' : ''), scoped ? [argument] : [], scoped && 'order' in scoped ? quote(scoped.order) : '', anchor, statements);
    if (!scoped)
        data = data.map(value => ({ ...value, key: json(value.cells) })).sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
    return issued(Object.freeze({ table, present: true, masterCells, schema: freezeCapturedData(schemas.map(row => row.semantic)), schemaCells: freezeCapturedData(schemas.map(row => row.cells)), columns: freezeCapturedData(metadata.map(row => row.semantic)), columnCells: freezeCapturedData(metadata.map(row => row.cells)), rows: freezeCapturedData(data.map(row => row.semantic)), cellRows: freezeCapturedData(data.map(row => row.cells)) }));
}
/** Readonly original facts; no source brand, callbacks or write grant. */
export function readNativeSqliteCensus(database, query, argument) {
    const scoped = Object.hasOwn(scopedQueries, query) ? scopedQueries[query] : undefined;
    if (!scoped && !inventoryTables.includes(query) || scoped && typeof argument !== 'string' || !scoped && argument !== undefined)
        throw Error('native_sqlite_census_query');
    const context = createContext(database), result = census(context, query, argument);
    finish(context);
    return result;
}
/** Fixed population, with one context for this synchronous transaction only. */
export function readNativeEnrollmentCensus(database) {
    if (arguments.length !== 1)
        throw Error('native_sqlite_census_query');
    const run = () => { const context = createContext(database), result = inventoryTables.map(table => census(context, table)); finish(context); return Object.freeze(result); };
    return database.inTransaction ? run() : database.transaction(run)();
}
export function readNativeKSwarmCensus(database, ownerKey, profileId) {
    if (arguments.length !== 3 || typeof ownerKey !== 'string' || typeof profileId !== 'string')
        throw Error('native_sqlite_census_query');
    const run = () => { const context = createContext(database), queries = ['owner', 'obligations', 'dependencies', 'registered', 'profile', 'invocations', 'receipts', 'subject', 'storageFeature']; const result = Object.fromEntries(queries.map(query => [query, census(context, query, query === 'storageFeature' ? 'kswarm-owner' : query === 'profile' ? profileId : ownerKey)])); finish(context); return Object.freeze(result); };
    return database.inTransaction ? run() : database.transaction(run)();
}
