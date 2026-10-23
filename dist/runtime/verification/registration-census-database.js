import { canonicalVerificationJson as json } from './protocol.js';
import { captureRegistrationSnapshot } from './registration-value-snapshot.js';
import { isDeepStrictEqual as initialIsDeepStrictEqual, types } from 'node:util';
const isDeepStrictEqual = initialIsDeepStrictEqual;
import { readPrivateDatabaseNativeAccess } from './private-database.js';
import { assertRegistrationIntrinsics, assertRegistrationWeakMapIntrinsics } from './registration-intrinsics.js';
import { assertNativeSqliteArrayConstruction, assertNativeSqliteColumnConstruction } from './native-sqlite-construction-intrinsics.js';
const isProxy = types.isProxy, freeze = Object.freeze;
const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, prototype = Object.getPrototypeOf;
const define = Object.defineProperty, nativePush = Array.prototype.push;
const nativeOwn = Object.hasOwn, nativeArray = Array.isArray, nativeKeys = Reflect.ownKeys, nativeSafeInteger = Number.isSafeInteger;
const arrayPrototype = Array.prototype, objectPrototype = Object.prototype, nativeString = String;
// Planning only, confined to one synchronous collector. Never authority/currentness.
function primitiveRawRows(rows) {
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        for (let j = 0; j < row.length; j++) {
            const value = row[j];
            if (value !== null && typeof value !== 'string' && (typeof value !== 'number' || !nativeSafeInteger(value)))
                return false;
        }
    }
    return true;
}
function primitiveRecords(rows) {
    for (let i = 0; i < rows.length; i++) {
        const keys = nativeKeys(rows[i]);
        for (let j = 0; j < keys.length; j++) {
            const d = descriptor(rows[i], keys[j]);
            if (!d || !nativeOwn(d, 'value'))
                return false;
            const v = d.value;
            if (v !== null && typeof v !== 'string' && (typeof v !== 'number' || !nativeSafeInteger(v)))
                return false;
        }
    }
    return true;
}
function privateStringArguments(args) {
    if (isProxy(args) || !nativeArray(args) || prototype(args) !== arrayPrototype)
        return false;
    const size = descriptor(args, 'length');
    if (!size || !nativeOwn(size, 'value') || typeof size.value !== 'number')
        return false;
    for (let i = 0; i < size.value; i++) {
        const d = descriptor(args, nativeString(i));
        if (!d || !nativeOwn(d, 'value') || typeof d.value !== 'string')
            return false;
    }
    return true;
}
function nonIntentSeed(raw) {
    if (!raw || typeof raw !== 'object' || isProxy(raw) || (prototype(raw) !== objectPrototype && prototype(raw) !== null) || nativeKeys(raw).length !== 3)
        return undefined;
    const p = descriptor(raw, 'profileId'), k = descriptor(raw, 'ownerKind'), o = descriptor(raw, 'ownerId');
    if (!p || !k || !o || !nativeOwn(p, 'value') || !nativeOwn(k, 'value') || !nativeOwn(o, 'value') || typeof p.value !== 'string' || typeof o.value !== 'string')
        return undefined;
    const kind = k.value;
    if (kind !== 'task' && kind !== 'goal' && kind !== 'loop' && kind !== 'project' && kind !== 'kswarm')
        return undefined;
    return { profileId: p.value, ownerKind: kind, ownerId: o.value };
}
function append(array, value) { define(array, array.length, { __proto__: null, value, enumerable: true, writable: true, configurable: true }); }
// Only private native result arrays, after the complete closing intrinsic
// fence. Parameter arrays before that fence retain defineProperty above.
function appendResult(array, value) { apply(nativePush, array, [value]); }
export const REGISTRATION_TABLE_KEYS = freeze({ verification_owner_dependencies: 'parent_key', owner_enrollment_intents: 'logical_owner_key', verification_registered_owners: 'owner_key', verification_owners: 'owner_key', mandatory_observation_checks: 'owner_key', verification_registered_invocations: 'owner_key', owner_enrollment_invocation_receipts: 'owner_key', owner_enrollment_goal_sessions: 'owner_key', owner_enrollment_loop_subjects: 'owner_key', owner_enrollment_intent_contracts: 'owner_key', owner_enrollment_kswarm_subjects: 'logical_owner_key', migration_publication_intents: 'owner_key', verification_application_pointers: 'owner_key', verification_application_history: 'owner_key', verification_application_transitions: 'owner_key' });
const tables = [...Object.keys(REGISTRATION_TABLE_KEYS), 'verification_profiles', 'verification_storage_features'];
const lower = (v) => v.replace(/[A-Z]/g, c => c.toLowerCase());
function fail() { throw Error('application_registration_changed'); }
/** Per-call full SQL census only. No row/permission/clock/current result crosses a checkpoint. */
export function createRegistrationCensusDatabase(db) {
    assertRegistrationWeakMapIntrinsics();
    const native = readPrivateDatabaseNativeAccess(db);
    if (!native)
        return undefined;
    function current() {
        assertRegistrationIntrinsics();
        if (isProxy(db) || descriptor(db, native.symbol)?.value !== native.cpp || prototype(db) !== native.databasePrototype || prototype(native.cpp) !== native.cppPrototype)
            fail();
        for (let i = 0; i < native.fingerprints.length; i++) {
            const entry = native.fingerprints[i];
            if (!isDeepStrictEqual(descriptor(entry.target, entry.key), entry.descriptor))
                fail();
        }
        if (apply(native.open, native.cpp, []) !== true)
            fail();
    }
    const prepare = (sql) => apply(native.prepare, native.cpp, [sql, db, false, false]);
    const call = (key, stmt, args = []) => apply(native.statement[key], stmt, args);
    // Only counter() calls raw, after the complete function_list fence and builtin check.
    // Its fixed header-read tail closes once before any counter result is returned.
    function raw(sql, args = []) { const stmt = prepare(sql); call('raw', stmt, [true]); const rows = call('all', stmt, args); return rows; }
    // Reuse exactly one prior private full close; consume before native prepare.
    // Disabled/first entry runs the original guard BEFORE any argument probe.
    function entry(fold, args, allowed = true) {
        const reuse = fold?.enabled === true && fold.ready === true;
        if (!reuse)
            assertNativeSqliteColumnConstruction();
        if (fold) {
            if (!allowed || !privateStringArguments(args)) {
                fold.enabled = false;
                if (reuse)
                    assertNativeSqliteColumnConstruction();
            }
            fold.ready = false;
        }
    }
    function records(sql, args = [], fold) {
        entry(fold, args, sql === 'SELECT * FROM main.verification_profiles WHERE profile_id=? OR uid IN (SELECT uid FROM main.verification_registered_owners WHERE owner_key=?) ORDER BY uid' || sql === 'SELECT * FROM main.verification_storage_features ORDER BY feature');
        // No post-prepare or post-all native-construction fence is folded.
        const stmt = prepare(sql);
        call('raw', stmt, [true]);
        assertNativeSqliteColumnConstruction();
        const columns = call('columns', stmt), rows = call('all', stmt, args);
        assertNativeSqliteColumnConstruction();
        if (fold && !primitiveRawRows(rows))
            fold.enabled = false;
        const result = copyRecords(columns, rows);
        if (fold)
            fold.ready = fold.enabled;
        return result;
    }
    function copyRecords(columns, rows) {
        const result = [];
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].length !== columns.length)
                fail();
            const row = { __proto__: null };
            for (let j = 0; j < columns.length; j++) {
                if (columns[j].name === '__proto__')
                    fail();
                row[columns[j].name] = rows[i][j];
            }
            appendResult(result, row);
        }
        return result;
    }
    // Private fixed-query reader: schema() already checked the realm before the
    // first call, or the preceding call checked it after all(). Keep both guards
    // after native SQL boundaries; prepare/step can reconnect a changed schema.
    function tableColumns(table) {
        const stmt = prepare('PRAGMA main.table_xinfo(' + table + ')');
        call('raw', stmt, [true]);
        assertNativeSqliteColumnConstruction();
        const columns = call('columns', stmt), rows = call('all', stmt);
        assertNativeSqliteColumnConstruction();
        return copyRecords(columns, rows);
    }
    function counter() {
        current();
        const funcs = records('PRAGMA function_list');
        if (!funcs.some(f => f.name === 'total_changes' && f.builtin === 1) || funcs.some(f => typeof f.name === 'string' && lower(f.name) === 'total_changes' && f.builtin !== 1))
            fail();
        const schema = raw('PRAGMA main.schema_version')[0]?.[0], data = raw('PRAGMA main.data_version')[0]?.[0];
        if (!Number.isSafeInteger(schema) || Number(schema) < 0 || !Number.isSafeInteger(data) || Number(data) < 0)
            fail();
        const stmt = prepare('SELECT total_changes() AS n');
        call('safeIntegers', stmt, [true]);
        call('raw', stmt, [true]);
        const row = call('get', stmt);
        assertNativeSqliteArrayConstruction();
        const changes = row?.[0];
        if (typeof changes !== 'bigint' || changes < 0n)
            fail();
        return { schema, data, changes };
    }
    function schema() {
        const modules = records('PRAGMA module_list');
        if (modules.some(r => typeof r.name === 'string' && tables.includes(lower(r.name))))
            fail();
        const master = records('SELECT type,name,tbl_name,rootpage,sql FROM main.sqlite_master ORDER BY type,name,tbl_name,rootpage,sql');
        for (const row of master)
            if (tables.includes(lower(String(row.name))) && row.type === 'table' && typeof row.sql === 'string' && /^CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql))
                fail();
        const kinds = records('PRAGMA main.table_list');
        for (const row of kinds)
            if (row.schema === 'main' && tables.includes(lower(String(row.name))) && (row.type !== 'table' && row.type !== 'view' || row.type === 'view' && ['verification_profiles', 'verification_storage_features'].includes(lower(String(row.name)))))
                fail();
        const columns = { __proto__: null }, present = new Set();
        // table_list stays fully guarded: SQLite may connect arbitrary views/vtabs.
        // Only private native metadata copying/control flow separates one table read
        // from the next. SQL callback/reconnect boundaries keep their original guards.
        // Non-text SQLite schema names may be Buffers with caller-modified coercion.
        // Such rows keep the complete original per-query fences and evaluation order.
        const adjacentMetadata = master.every(row => typeof row.name === 'string');
        // table_list may have entered callbacks. Use its final positive classification,
        // not only the earlier master row, before trusting an existing main snapshot.
        const transactionMetadata = adjacentMetadata && typeof native.inTransaction === 'function' && apply(native.inTransaction, native.cpp, []) === true && tables.every(table => !master.some(row => row.type === 'table' && lower(row.name) === table) || kinds.some(row => row.schema === 'main' && row.name === table && row.type === 'table'));
        if (adjacentMetadata)
            assertNativeSqliteColumnConstruction();
        if (transactionMetadata) {
            // No transaction is created here. Fixed ordinary-table metadata only, using
            // the existing read snapshot acquired by successful guarded table_list.
            // Native addon/VFS/extension provenance remains the trusted-native boundary.
            const pending = [];
            // This layout belongs only to this synchronous transaction metadata batch.
            let layout;
            for (const table of tables) {
                const entry = master.find(row => row.type === 'table' && lower(String(row.name)) === table);
                if (!entry)
                    continue;
                if (entry.name === table)
                    present.add(table);
                const stmt = prepare('PRAGMA main.table_xinfo(' + table + ')');
                call('raw', stmt, [true]);
                const names = layout ?? call('columns', stmt), rows = call('all', stmt);
                layout = names;
                append(pending, { table, columns: names, rows });
            }
            assertNativeSqliteColumnConstruction();
            for (let i = 0; i < pending.length; i++) {
                const item = pending[i], value = copyRecords(item.columns, item.rows);
                if (value.some(c => c.hidden !== 0 || c.name === '__proto__'))
                    fail();
                columns[item.table] = value;
            }
        }
        else {
            for (const table of tables) {
                const entry = master.find(row => row.type === 'table' && lower(String(row.name)) === table);
                if (!entry)
                    continue;
                if (entry.name === table)
                    present.add(table);
                const value = adjacentMetadata ? tableColumns(table) : records('PRAGMA main.table_xinfo(' + table + ')');
                if (value.some(c => c.hidden !== 0 || c.name === '__proto__'))
                    fail();
                columns[table] = value;
            }
        }
        return { master, columns, present };
    }
    function beginCensus(fold) {
        const before = counter(), structure = schema();
        if (!isDeepStrictEqual(before, counter()))
            fail();
        return { evidence: { master: structure.master, columns: structure.columns }, has: (table) => structure.present.has(table), records: (sql, args = []) => records(sql, args, fold),
            groups(table, lookups) {
                entry(fold, lookups);
                if (!Object.hasOwn(REGISTRATION_TABLE_KEYS, table))
                    fail();
                const result = new Map();
                for (const key of lookups)
                    result.set(key, []);
                if (!structure.present.has(table) || !lookups.length)
                    return result;
                const unique = [...result.keys()];
                for (let start = 0; start < unique.length; start += 128) {
                    const count = Math.min(128, unique.length - start), values = [];
                    for (let i = 0; i < count; i++)
                        append(values, unique[start + i]);
                    const sql = 'WITH wanted(lookup) AS (VALUES ' + Array(count).fill('(?)').join(',') + ') SELECT wanted.lookup,item.* FROM wanted JOIN main.' + table + ' AS item ON item.' + REGISTRATION_TABLE_KEYS[table] + '=wanted.lookup';
                    if (fold)
                        fold.ready = false;
                    const stmt = prepare(sql);
                    call('raw', stmt, [true]);
                    assertNativeSqliteColumnConstruction();
                    const cols = call('columns', stmt), rows = call('all', stmt, values);
                    assertNativeSqliteColumnConstruction();
                    if (fold && !primitiveRawRows(rows))
                        fold.enabled = false;
                    for (let i = 0; i < rows.length; i++) {
                        const source = rows[i], key = source[0];
                        if (typeof key !== 'string' || !result.has(key) || source.length !== cols.length)
                            fail();
                        const row = { __proto__: null };
                        for (let j = 1; j < cols.length; j++) {
                            if (cols[j].name === '__proto__')
                                fail();
                            row[cols[j].name] = source[j];
                        }
                        appendResult(result.get(key), row);
                    }
                    if (fold)
                        fold.ready = fold.enabled;
                }
                return result;
            }, finish() { if (fold) {
                fold.enabled = false;
                fold.ready = false;
            } if (!isDeepStrictEqual(counter(), before) || !isDeepStrictEqual(schema(), structure) || !isDeepStrictEqual(counter(), before))
                fail(); } };
    }
    ;
    function collectFixedRegistrationData(raw) {
        const owner = nonIntentSeed(raw);
        if (!owner)
            return undefined; // Only decline before all SQL.
        const fold = { enabled: true, ready: false }; // First entry fully checked; enabled only true -> false; never escapes.
        function registrationRows(rows) {
            if (rows.length < 2)
                return [...rows];
            return rows.map(row => ({ row, key: json(row) })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(value => value.row);
        }
        function registrationVector(nodes) {
            const sorted = [...nodes].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
            for (let index = 0; index < sorted.length; index++)
                if (typeof sorted[index].key !== 'string' || (index > 0 && sorted[index - 1].key === sorted[index].key))
                    throw Error('application_registration_changed');
            return captureRegistrationSnapshot(sorted);
        }
        const census = beginCensus(fold), root = json(owner), pending = [root], identities = new Map(), dependencies = new Map();
        while (pending.length) {
            const frontier = [];
            while (pending.length) {
                const key = pending.pop();
                if (identities.has(key))
                    continue;
                if (typeof key !== 'string')
                    fold.enabled = false;
                const identity = JSON.parse(key);
                if (!nonIntentSeed(identity))
                    fold.enabled = false;
                identities.set(key, identity);
                if (identities.size > 4096)
                    throw Error('application_registration_changed');
                frontier.push(key);
            }
            const found = census.groups('verification_owner_dependencies', frontier);
            for (const key of frontier) {
                const edges = found.get(key);
                dependencies.set(key, edges);
                for (const edge of edges)
                    pending.push(edge.child_key);
            }
        }
        const keys = [...identities.keys()], profileRows = new Map(keys.map(key => [key, census.records('SELECT * FROM main.verification_profiles WHERE profile_id=? OR uid IN (SELECT uid FROM main.verification_registered_owners WHERE owner_key=?) ORDER BY uid', [identities.get(key).profileId, key])])), logicalByOwner = new Map(), logicalKeys = new Set();
        for (const key of keys) {
            const profileValues = profileRows.get(key);
            for (let i = 0; i < profileValues.length; i++) {
                const p = descriptor(profileValues[i], 'account_id'), u = descriptor(profileValues[i], 'uid');
                if (!p || !u || !nativeOwn(p, 'value') || !nativeOwn(u, 'value') || typeof p.value !== 'string' || !nativeSafeInteger(u.value))
                    fold.enabled = false;
            }
            const identity = identities.get(key), logical = profileValues.map(p => json({ uid: p.uid, accountGeneration: p.account_id.toUpperCase(), ownerKind: identity.ownerKind, ownerId: identity.ownerId }));
            logicalByOwner.set(key, logical);
            for (const value of logical)
                logicalKeys.add(value);
        }
        const grouped = new Map();
        for (const table of Object.keys(REGISTRATION_TABLE_KEYS)) {
            if (table === 'verification_owner_dependencies')
                continue;
            grouped.set(table, census.groups(table, REGISTRATION_TABLE_KEYS[table] === 'logical_owner_key' ? [...logicalKeys] : keys));
        }
        const rawStorageFeatures = census.records('SELECT * FROM main.verification_storage_features ORDER BY feature');
        // End folding before all final canonicalization/snapshot and original finish.
        fold.enabled = false;
        const rows = (table, key) => captureRegistrationSnapshot(registrationRows(grouped.get(table).get(key) ?? []), false), storageFeatures = registrationRows(rawStorageFeatures), vectors = [];
        for (const key of keys) {
            const identity = identities.get(key), profiles = profileRows.get(key), logical = logicalByOwner.get(key), owners = rows('verification_registered_owners', key), invocations = rows('verification_registered_invocations', key);
            vectors.push({ key, profiles, dependencies: registrationRows(dependencies.get(key)), intents: registrationRows(logical.flatMap(value => rows('owner_enrollment_intents', value))), owner: owners, verification: rows('verification_owners', key), mandatory: rows('mandatory_observation_checks', key), invocations, invocationReceipts: rows('owner_enrollment_invocation_receipts', key), goalSessions: rows('owner_enrollment_goal_sessions', key), loopSubjects: rows('owner_enrollment_loop_subjects', key), intentContracts: rows('owner_enrollment_intent_contracts', key), kswarmSubjects: registrationRows(logical.flatMap(value => rows('owner_enrollment_kswarm_subjects', value))), storageFeatures: captureRegistrationSnapshot(storageFeatures), migration: rows('migration_publication_intents', key), application: rows('verification_application_pointers', key), history: rows('verification_application_history', key), transitions: rows('verification_application_transitions', key) });
        }
        census.finish();
        const vector = registrationVector(vectors);
        return { vector, evidence: census.evidence };
    }
    return freeze({ begin: () => beginCensus(), collectFixedRegistrationData });
}
