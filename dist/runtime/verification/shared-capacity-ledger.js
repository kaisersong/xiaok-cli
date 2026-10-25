import { assertMetadataReplacementLineage, assertMetadataReplacementFees, metadataReplacementResultHash } from './metadata-replacement-lineage.js';
import { assertInstalledCapacityReplacementCommit, executeInstalledCapacityReplacementCommit, assertInstalledCapacityReplacement, readInstalledCapacityAuthority, claimInstalledCapacityLayer, finishInstalledCapacityLayer, failInstalledCapacityLayer } from './installed-controller.js';
import { readSharedCapacityOwners, readSharedCapacityOwner, assertSharedCapacityReleased } from './shared-blob-capacity.js';
import { inspectSharedCapacityCommand, executeSharedCapacityCommand } from './shared-capacity-command-dispatch.js';
import { createHash } from 'node:crypto';
import { inspectCapacityMetadataCommand, executeCapacityMetadataCommand } from './capacity-ledger-command-dispatch.js';
import { types } from 'node:util';
import { canonicalVerificationJson as json, VERIFICATION_BUDGET } from './protocol.js';
import { assertVerificationDatabaseBudget, runVerificationTransaction } from './storage-budget.js';
const MiB = 1024 ** 2;
const ledgerIdentities = new WeakMap();
export function assertSharedCapacityLedgerDatabase(ledger, database, authorityId) { const facts = ledgerIdentities.get(ledger); if (!facts || facts.database !== database || facts.authorityId !== authorityId || facts.state.closed)
    throw Error('shared_capacity_database_identity'); }
export function assertSharedCapacityLedgerAuthority(ledger, authority) { const fact = ledgerIdentities.get(ledger); if (!fact || fact.authority !== authority || fact.state.closed)
    throw Error('shared_capacity_database_identity'); }
export const SHARED_CAPACITY_PARTITIONS = Object.freeze({ control: 128 * MiB, rollback: 144 * MiB, outbox: 32 * MiB, auxiliary: 16 * MiB, counter: 256 * MiB, reference: 34 * MiB, 'compound-domain': MiB, 'canonical-alias': MiB, egress: 20 * MiB, participant: 130 * MiB, archive: 1472 * MiB });
const sharedCommandContexts = new WeakMap();
export function consumeSharedCapacityCommandContext(context, ledger, database, command) { const fact = sharedCommandContexts.get(context); if (!fact || fact.used || fact.ledger !== ledger || fact.database !== database || fact.command !== command || !database.inTransaction)
    throw Error('shared_capacity_command_context'); fact.used = true; }
const metadataCommandContexts = new WeakMap();
export function consumeCapacityMetadataContext(context, ledger, database, command) { const facts = metadataCommandContexts.get(context); if (!facts || facts.used || facts.ledger !== ledger || facts.database !== database || facts.command !== command || !database.inTransaction)
    throw Error('capacity_metadata_command_context'); facts.used = true; return facts.allocations; }
const replacementCommitContexts = new WeakMap();
export function consumeCapacityMetadataReplacementContext(context, ledger, database, proof) { const f = replacementCommitContexts.get(context); if (!f || f.used || f.ledger !== ledger || f.database !== database || f.proof !== proof || !database.inTransaction)
    throw Error('shared_capacity_replacement_context'); const identity = ledgerIdentities.get(ledger); if (!identity)
    throw Error('shared_capacity_replacement_context'); assertSharedCapacityLedgerDatabase(ledger, database, identity.authorityId); f.used = true; return f.result; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function id(value) { if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 256 || /[\x00-\x1f\x7f]/.test(value))
    throw Error('shared_capacity_identity'); }
function synchronous(value) { if (value !== undefined) {
    void Promise.resolve(value).catch(() => { });
    throw Error('shared_capacity_sync');
} }
function fields(value, keys) { if (types.isProxy(value) || !value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length)
    throw Error('shared_capacity_shape'); const result = {}; for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !('value' in d))
        throw Error('shared_capacity_shape');
    result[key] = d.value;
} return result; }
/** Capacity facts only. This module does not authorize a writer, choose a caller's
 * profile or turn an allocation into proof of resource creation/deletion. */
export function createSharedCapacityLedger(authority) {
    if (arguments.length !== 1)
        throw Error('capacity_authority_configuration');
    const { database: db, authorityId } = claimInstalledCapacityLayer(authority, 'ledger');
    const assertCurrent = () => { const actual = readInstalledCapacityAuthority(authority); if (actual.database !== db || actual.authorityId !== authorityId)
        throw Error('shared_capacity_database_identity'); }, inspectOwner = (binding) => readSharedCapacityOwner(authority, binding), assertReleased = (receipt, record) => assertSharedCapacityReleased(authority, receipt, record), assertMetadataReplacement = (receipt, facts) => assertInstalledCapacityReplacement(authority, receipt, facts);
    id(authorityId);
    const poolId = 'capacity-' + hash(authorityId);
    try {
        const owners = new WeakMap(), lifetime = { closed: false };
        let busy = false;
        let activeReplacement, approvedCommit;
        const approvedRows = new Map(), approvedAttributes = new Map(), approvedTransfers = new Set();
        const expectedPreparedRows = new Map();
        let expectedCommitRow;
        const expectedTransfers = new Map();
        let capacityBaseline, replacementBaseline, capacityPoisoned = false;
        if (db.inTransaction)
            throw Error('shared_capacity_outer_transaction');
        synchronous(assertCurrent());
        function identity() { if (lifetime.closed)
            throw Error('shared_capacity_closed'); const r = db.prepare('SELECT authority_id,pool_id FROM shared_capacity_identity WHERE id=1').get(); if (!r || r.authority_id !== authorityId || r.pool_id !== poolId)
            throw Error('shared_capacity_pool_identity'); }
        function ownerIdentity(binding) { const raw = inspectOwner(binding); if (raw && typeof raw.then === 'function') {
            void Promise.resolve(raw).catch(() => { });
            throw Error('shared_capacity_sync');
        } const value = fields(raw, ['sessionKey', 'producerKey']); id(value.sessionKey); id(value.producerKey); return Object.freeze(value); }
        function ownersCurrent(tokens) {
            const entries = tokens.map(token => { identity(); const found = token && typeof token === 'object' ? owners.get(token) : undefined; if (!found)
                throw Error('shared_capacity_owner'); synchronous(assertCurrent()); return found; });
            const current = readSharedCapacityOwners(authority, entries.map(entry => entry.binding));
            if (!Array.isArray(current) || current.length !== entries.length)
                throw Error('shared_capacity_owner_changed');
            return entries.map((entry, index) => { const raw = current[index]; if (raw && typeof raw.then === 'function') {
                void Promise.resolve(raw).catch(() => { });
                throw Error('shared_capacity_sync');
            } const value = fields(raw, ['sessionKey', 'producerKey']); id(value.sessionKey); id(value.producerKey); if (json(value) !== json(entry.identity))
                throw Error('shared_capacity_owner_changed'); return entry.identity; });
        }
        function owner(token, newAdmission = false) { identity(); const found = token && typeof token === 'object' ? owners.get(token) : undefined; if (!found)
            throw Error('shared_capacity_owner'); if (newAdmission) {
            synchronous(assertCurrent());
            if (json(ownerIdentity(found.binding)) !== json(found.identity))
                throw Error('shared_capacity_owner_changed');
        } return found.identity; }
        function write(work) {
            identity();
            if (busy || db.inTransaction)
                throw Error('shared_capacity_reentrant_transaction');
            busy = true;
            approvedRows.clear();
            approvedAttributes.clear();
            approvedTransfers.clear();
            expectedTransfers.clear();
            approvedCommit = undefined;
            expectedCommitRow = undefined;
            expectedPreparedRows.clear();
            capacityPoisoned = false;
            try {
                return runVerificationTransaction(db, () => {
                    identity();
                    assertMetadataReplacementLineage(db, poolId, authorityId);
                    replacementBaseline = replacementDigest();
                    capacityBaseline = capacityStateDigest();
                    const result = work();
                    assertCapacityStep();
                    assertMetadataReplacementLineage(db, poolId, authorityId);
                    return result;
                });
            }
            finally {
                busy = false;
                activeReplacement = undefined;
                approvedCommit = undefined;
                expectedCommitRow = undefined;
                expectedPreparedRows.clear();
                capacityBaseline = undefined;
                replacementBaseline = undefined;
                capacityPoisoned = false;
                approvedRows.clear();
                approvedAttributes.clear();
                approvedTransfers.clear();
                expectedTransfers.clear();
            }
        }
        // These are the complete persisted charge predicates, including terminal
        // transfers. Only exact mutations of this original ledger can normalize.
        function capacityStateDigest(normalize = false) {
            const digest = createHash('sha256'), add = (v) => { const encoded = json(v); digest.update(String(Buffer.byteLength(encoded)) + ':' + encoded); };
            for (const row of db.prepare('SELECT * FROM shared_capacity_identity ORDER BY id').iterate())
                add(['identity', row]);
            for (const row of db.prepare('SELECT * FROM shared_capacity_reservations ORDER BY operation_id').iterate()) {
                const value = normalizeRow(row, normalize);
                if (value !== null)
                    add(['reservation', value]);
            }
            let operation, group = [];
            const flush = () => { if (operation === undefined)
                return; const allowed = normalize ? approvedAttributes.get(operation) : undefined; if (allowed) {
                if (json(group) !== allowed.after)
                    throw Error('shared_capacity_replacement_changed');
                for (const row of JSON.parse(allowed.before))
                    add(['attribution', row]);
            }
            else
                for (const row of group)
                    add(['attribution', row]); };
            for (const row of db.prepare('SELECT * FROM shared_capacity_session_attributions ORDER BY operation_id,beneficiary_session_key').iterate()) {
                if (operation !== row.operation_id) {
                    flush();
                    operation = row.operation_id;
                    group = [];
                }
                group.push(row);
            }
            flush();
            for (const row of db.prepare('SELECT * FROM shared_capacity_transfers ORDER BY operation_id').iterate()) {
                const expected = normalize ? expectedTransfers.get(row.operation_id) : undefined;
                if (expected) {
                    if (json(row) !== json(expected))
                        throw Error('shared_capacity_replacement_changed');
                }
                else
                    add(['transfer', row]);
            }
            return digest.digest('hex');
        }
        function assertCapacityStep() {
            try {
                if (capacityPoisoned || !busy || !db.inTransaction || capacityBaseline === undefined || replacementBaseline === undefined || capacityStateDigest(true) !== capacityBaseline || replacementDigest(true) !== replacementBaseline)
                    throw Error('shared_capacity_replacement_changed');
            }
            catch (error) {
                capacityPoisoned = true;
                throw error;
            }
        }
        runVerificationTransaction(db, () => {
            synchronous(assertCurrent());
            db.exec('CREATE TABLE IF NOT EXISTS shared_capacity_identity(id INTEGER PRIMARY KEY CHECK(id=1),authority_id TEXT NOT NULL,pool_id TEXT NOT NULL)');
            const r = db.prepare('SELECT authority_id,pool_id FROM shared_capacity_identity WHERE id=1').get();
            if (r && (r.authority_id !== authorityId || r.pool_id !== poolId))
                throw Error('shared_capacity_pool_identity');
            assertVerificationDatabaseBudget(db, { additionalBytes: 8192 });
            if (!r)
                db.prepare('INSERT INTO shared_capacity_identity VALUES(1,?,?)').run(authorityId, poolId);
            db.exec("CREATE TABLE IF NOT EXISTS shared_capacity_reservations(operation_id TEXT PRIMARY KEY,session_key TEXT NOT NULL,producer_key TEXT NOT NULL,resource_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>0),partition_name TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes>0),tuple_hash TEXT NOT NULL,tuple_json TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reserved','committed','release_pending','released','unknown')),revision INTEGER NOT NULL,was_unknown INTEGER NOT NULL CHECK(was_unknown IN (0,1)),UNIQUE(producer_key,resource_id,generation))");
            assertVerificationDatabaseBudget(db, { additionalBytes: 8192 });
            db.exec("CREATE TABLE IF NOT EXISTS shared_capacity_session_attributions(operation_id TEXT NOT NULL,beneficiary_session_key TEXT NOT NULL,beneficiary_producer_key TEXT NOT NULL,physical_tuple_hash TEXT NOT NULL,attribution_json TEXT NOT NULL,attribution_hash TEXT NOT NULL,PRIMARY KEY(operation_id,beneficiary_session_key),FOREIGN KEY(operation_id) REFERENCES shared_capacity_reservations(operation_id))");
            assertVerificationDatabaseBudget(db, { additionalBytes: 16384 });
            db.exec("CREATE TABLE IF NOT EXISTS shared_metadata_replacements(replacement_id TEXT PRIMARY KEY,intent_id TEXT NOT NULL,request_hash TEXT NOT NULL,request_json TEXT NOT NULL,state TEXT NOT NULL CHECK(state='prepared'));CREATE TABLE IF NOT EXISTS shared_metadata_replacement_claims(operation_id TEXT PRIMARY KEY,replacement_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('source','staging','unused','target')),FOREIGN KEY(replacement_id) REFERENCES shared_metadata_replacements(replacement_id))");
            db.exec("CREATE TABLE IF NOT EXISTS shared_metadata_replacement_resource_claims(producer_key TEXT NOT NULL,resource_id TEXT NOT NULL,generation INTEGER NOT NULL,operation_id TEXT NOT NULL UNIQUE,replacement_id TEXT NOT NULL,PRIMARY KEY(producer_key,resource_id,generation),FOREIGN KEY(operation_id) REFERENCES shared_metadata_replacement_claims(operation_id))");
            assertVerificationDatabaseBudget(db, { additionalBytes: 24576 });
            db.exec("CREATE TABLE IF NOT EXISTS shared_metadata_replacement_commits(replacement_id TEXT PRIMARY KEY,commit_sequence INTEGER NOT NULL UNIQUE CHECK(commit_sequence>0),intent_id TEXT NOT NULL,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,FOREIGN KEY(replacement_id) REFERENCES shared_metadata_replacements(replacement_id));CREATE TABLE IF NOT EXISTS shared_capacity_transfers(operation_id TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state='transferred'),replacement_id TEXT NOT NULL,tuple_hash TEXT NOT NULL,revision INTEGER NOT NULL,FOREIGN KEY(operation_id) REFERENCES shared_capacity_reservations(operation_id),FOREIGN KEY(replacement_id) REFERENCES shared_metadata_replacement_commits(replacement_id) DEFERRABLE INITIALLY DEFERRED);CREATE TABLE IF NOT EXISTS shared_metadata_replacement_consumptions(operation_id TEXT PRIMARY KEY,replacement_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('source','staging','unused')),FOREIGN KEY(replacement_id) REFERENCES shared_metadata_replacements(replacement_id))");
            for (const claim of db.prepare("SELECT * FROM shared_metadata_replacement_claims WHERE role<>'target'").iterate()) {
                const existing = db.prepare('SELECT * FROM shared_metadata_replacement_consumptions WHERE operation_id=?').get(claim.operation_id);
                if (existing && json(existing) !== json(claim))
                    throw Error('shared_capacity_replacement_changed');
                if (!existing) {
                    assertVerificationDatabaseBudget(db, { additionalBytes: 2048 });
                    db.prepare('INSERT INTO shared_metadata_replacement_consumptions VALUES(?,?,?)').run(claim.operation_id, claim.replacement_id, claim.role);
                }
            }
        });
        function assertResourceUnclaimed(producerKey, resourceId, generation) {
            if (db.prepare("SELECT 1 FROM shared_metadata_replacement_claims c LEFT JOIN shared_metadata_replacement_resource_claims r ON r.operation_id=c.operation_id AND r.replacement_id=c.replacement_id WHERE c.role='target' AND r.operation_id IS NULL LIMIT 1").get())
                throw Error('shared_capacity_replacement_incomplete');
            for (const r of db.prepare('SELECT replacement_id FROM shared_metadata_replacement_resource_claims WHERE producer_key=? AND resource_id=? AND generation=?').iterate(producerKey, resourceId, generation))
                if (replacementHeld(r.replacement_id))
                    throw Error('shared_capacity_replacement_held');
        }
        function assertUnclaimed(operationId) { for (const table of ['shared_metadata_replacement_claims', 'shared_metadata_replacement_consumptions']) {
            const r = db.prepare('SELECT replacement_id FROM ' + table + ' WHERE operation_id=?').get(operationId);
            if (r && replacementHeld(r.replacement_id))
                throw Error('shared_capacity_replacement_held');
        } }
        // Physical rows only normalize the exact mutations performed by this ledger.
        // Fixed execution cannot declare an exemption or alter an expected after-row.
        function replacementDigest(normalize = false) {
            const digest = createHash('sha256'), add = (v) => { const encoded = json(v); digest.update(String(Buffer.byteLength(encoded)) + ':' + encoded); };
            add(sqlSchemaDigest());
            const original = '';
            for (const table of ['shared_metadata_replacements', 'shared_metadata_replacement_resource_claims', 'shared_metadata_replacement_claims', 'shared_metadata_replacement_consumptions'])
                for (const r of db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').iterate()) {
                    const value = normalizePreparedRow(table, r, normalize);
                    if (value !== null)
                        add([table, value]);
                }
            for (const r of db.prepare('SELECT * FROM shared_metadata_replacement_commits' + original + ' ORDER BY commit_sequence').iterate())
                if (normalize && r.replacement_id === approvedCommit) {
                    if (!expectedCommitRow || json(r) !== json(expectedCommitRow))
                        throw Error('shared_capacity_replacement_changed');
                }
                else
                    add(['commit', r]);
            for (const r of db.prepare('SELECT * FROM shared_capacity_transfers' + original + ' ORDER BY operation_id').iterate())
                if (!(normalize && approvedTransfers.has(r.operation_id)))
                    add(['transfer', r]);
            const seen = new Set();
            for (const table of ['shared_metadata_replacement_claims', 'shared_metadata_replacement_consumptions'])
                for (const c of db.prepare('SELECT * FROM ' + table + ' ORDER BY operation_id').iterate()) {
                    if (normalizePreparedRow(table, c, normalize) !== null)
                        seen.add(c.operation_id);
                }
            for (const operationId of [...seen].sort()) {
                add([operationId, normalizeRow(rawRow(operationId), normalize)]);
                const current = json(attributionSet(operationId)), allowed = normalize ? approvedAttributes.get(operationId) : undefined;
                if (allowed) {
                    if (current !== allowed.after)
                        throw Error('shared_capacity_replacement_changed');
                    add(allowed.before);
                }
                else
                    add(current);
            }
            for (const r of db.prepare('SELECT * FROM shared_metadata_replacement_resource_claims' + original + ' ORDER BY operation_id').iterate()) {
                if (normalizePreparedRow('shared_metadata_replacement_resource_claims', r, normalize) === null)
                    continue;
                let occupied = false;
                for (const row of db.prepare('SELECT * FROM shared_capacity_reservations WHERE producer_key=? AND resource_id=? AND generation=? ORDER BY operation_id').iterate(r.producer_key, r.resource_id, r.generation)) {
                    occupied = true;
                    add(normalizeRow(row, normalize));
                }
                if (!occupied)
                    add(null);
            }
            return digest.digest('hex');
        }
        // Private fixed prepare SQL can register only its exact, previously absent
        // rows. No caller, command, receipt or trigger can declare an exemption.
        function normalizePreparedRow(table, row, normalize) {
            if (!normalize)
                return row;
            const key = table === 'shared_metadata_replacements' ? 'replacement_id' : 'operation_id', expected = expectedPreparedRows.get(table)?.get(row[key]);
            if (!expected)
                return row;
            if (json(row) !== json(expected))
                throw Error('shared_capacity_replacement_changed');
            return null;
        }
        function insertPreparedRow(table, expected, fixedSql) {
            assertCapacityStep();
            const key = table === 'shared_metadata_replacements' ? 'replacement_id' : 'operation_id', value = expected[key];
            id(value);
            const statement = db.prepare('SELECT * FROM ' + table + ' WHERE ' + key + '=?');
            if (statement.get(value))
                throw Error('shared_capacity_replacement_changed');
            fixedSql();
            const actual = statement.get(value);
            if (json(actual) !== json(expected)) {
                capacityPoisoned = true;
                throw Error('shared_capacity_replacement_changed');
            }
            let rows = expectedPreparedRows.get(table);
            if (!rows) {
                rows = new Map();
                expectedPreparedRows.set(table, rows);
            }
            rows.set(value, expected);
            assertCapacityStep();
        }
        function freezeReplacement(value) { if (value && typeof value === 'object') {
            for (const item of Object.values(value))
                freezeReplacement(item);
            Object.freeze(value);
        } return value; }
        const rawRow = (operationId) => db.prepare('SELECT * FROM shared_capacity_reservations WHERE operation_id=?').get(operationId);
        function rememberRow(operationId, before, after) { const previous = approvedRows.get(operationId); approvedRows.set(operationId, { before: previous ? previous.before : before, after }); }
        function normalizeRow(r, normalize) { if (!normalize || !r)
            return r ?? null; const allowed = approvedRows.get(r.operation_id); if (!allowed)
            return r; if (json(r) !== json(allowed.after))
            throw Error('shared_capacity_replacement_changed'); return allowed.before ?? null; }
        function sqlSchemaDigest() { return hash(json(['main', 'temp'].flatMap(schema => db.prepare('SELECT type,name,tbl_name,sql FROM ' + schema + '.sqlite_schema ORDER BY type,name').all().map(row => [schema, row])))); }
        const replacementTables = ['shared_metadata_replacements', 'shared_metadata_replacement_claims', 'shared_metadata_replacement_resource_claims', 'shared_metadata_replacement_commits', 'shared_capacity_transfers', 'shared_metadata_replacement_consumptions', 'shared_capacity_reservations', 'shared_capacity_session_attributions'];
        function metadataPopulationCounts() { return replacementTables.map(table => db.prepare('SELECT COUNT(*) n FROM ' + table).get().n); }
        function preparedHistoryDigest() { return hash(json(replacementTables.slice(0, 3).concat('shared_metadata_replacement_consumptions').map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()))); }
        function readSnapshot(work) { identity(); const body = () => { identity(); assertMetadataReplacementLineage(db, poolId, authorityId); return work(); }; return db.inTransaction ? body() : db.transaction(body).deferred(); }
        function committedReplacement(id) { return !!db.prepare('SELECT 1 FROM shared_metadata_replacement_commits WHERE replacement_id=?').get(id); }
        function replacementHeld(id) { return id !== activeReplacement && !committedReplacement(id); }
        function row(operationId) { id(operationId); const r = rawRow(operationId); if (!r)
            return undefined; const t = db.prepare('SELECT revision FROM shared_capacity_transfers WHERE operation_id=?').get(operationId); return t ? { ...r, state: 'transferred', revision: t.revision } : r; }
        function record(r) { const tuple = JSON.parse(r.tuple_json); if (hash(r.tuple_json) !== r.tuple_hash || json(tuple) !== r.tuple_json || tuple.poolId !== poolId || tuple.operationId !== r.operation_id || tuple.sessionKey !== r.session_key || tuple.producerKey !== r.producer_key || tuple.resourceId !== r.resource_id || tuple.generation !== r.generation || tuple.partition !== r.partition_name || tuple.bytes !== r.bytes || !Number.isSafeInteger(r.revision) || r.revision < 1)
            throw Error('shared_capacity_record'); return Object.freeze({ ...tuple, state: r.state, revision: r.revision, wasUnknown: r.was_unknown === 1 }); }
        function owned(token, operationId) { const o = owner(token), r = row(operationId); if (!r || r.session_key !== o.sessionKey || r.producer_key !== o.producerKey)
            throw Error('shared_capacity_operation'); record(r); return r; }
        function sessionUsage(sessionKey) {
            const physical = db.prepare("SELECT COALESCE(SUM(bytes),0) n FROM shared_capacity_reservations WHERE state<>'released' AND NOT EXISTS(SELECT 1 FROM shared_capacity_transfers WHERE operation_id=shared_capacity_reservations.operation_id) AND session_key=?").get(sessionKey).n;
            const attributed = db.prepare("SELECT COALESCE(SUM(r.bytes),0) n FROM shared_capacity_session_attributions a JOIN shared_capacity_reservations r ON r.operation_id=a.operation_id WHERE r.state<>'released' AND NOT EXISTS(SELECT 1 FROM shared_capacity_transfers WHERE operation_id=r.operation_id) AND a.beneficiary_session_key=?").get(sessionKey).n;
            return physical + attributed;
        }
        const attributionPartitions = new Set(['control', 'rollback', 'outbox', 'auxiliary', 'reference', 'compound-domain', 'canonical-alias', 'egress', 'participant']);
        function attributionInput(raw) { const captured = fields(raw, ['physicalOwner', 'beneficiaryOwner', 'operationId']); id(captured.operationId); return captured; }
        function attributionRow(operationId, sessionKey) { return db.prepare('SELECT * FROM shared_capacity_session_attributions WHERE operation_id=? AND beneficiary_session_key=?').get(operationId, sessionKey); }
        function attributionTuple(physical, beneficiary) { const original = record(physical); return Object.freeze({ poolId, operationId: original.operationId, physicalTupleHash: physical.tuple_hash, physicalSessionKey: original.sessionKey, physicalProducerKey: original.producerKey, beneficiarySessionKey: beneficiary.sessionKey, beneficiaryProducerKey: beneficiary.producerKey, bytes: original.bytes }); }
        function readAttribution(physical, beneficiary) {
            const r = attributionRow(physical.operation_id, beneficiary.sessionKey);
            if (!r)
                return undefined;
            const expected = attributionTuple(physical, beneficiary), encoded = json(expected);
            if (r.operation_id !== physical.operation_id || r.beneficiary_session_key !== beneficiary.sessionKey || r.beneficiary_producer_key !== beneficiary.producerKey || r.physical_tuple_hash !== physical.tuple_hash || r.attribution_json !== encoded || r.attribution_hash !== hash(encoded))
                throw Error('shared_capacity_attribution_binding');
            return Object.freeze({ ...expected, charged: physical.state !== 'released' && physical.state !== 'transferred' });
        }
        function update(r, state) { assertCapacityStep(); if (r.state === 'transferred' || state === 'transferred')
            throw Error('shared_capacity_transition'); const before = rawRow(r.operation_id); assertVerificationDatabaseBudget(db, { additionalBytes: 512 }); const changed = db.prepare('UPDATE shared_capacity_reservations SET state=?,revision=revision+1,was_unknown=? WHERE operation_id=? AND state=? AND revision=? AND tuple_hash=?').run(state, state === 'unknown' ? 1 : r.was_unknown, r.operation_id, r.state, r.revision, r.tuple_hash); if (changed.changes !== 1)
            throw Error('shared_capacity_transition'); const after = rawRow(r.operation_id), expected = { ...before, state, revision: before.revision + 1, was_unknown: state === 'unknown' ? 1 : before.was_unknown }; if (json(after) !== json(expected))
            throw Error('shared_capacity_replacement_changed'); rememberRow(r.operation_id, before, after); assertCapacityStep(); return record(row(r.operation_id)); }
        function transition(token, operationId, state, allowed) { return write(() => { const r = owned(token, operationId); assertUnclaimed(operationId); if (r.state === state)
            return record(r); if (!allowed.includes(r.state))
            throw Error('shared_capacity_transition'); return update(r, state); }); }
        function reserveInTransaction(token, raw) {
            assertCapacityStep();
            const value = fields(raw, ['operationId', 'resourceId', 'generation', 'partition', 'bytes', 'bindingHash']);
            id(value.operationId);
            id(value.resourceId);
            if (!Number.isSafeInteger(value.generation) || value.generation < 1 || typeof value.partition !== 'string' || !Object.hasOwn(SHARED_CAPACITY_PARTITIONS, value.partition) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > VERIFICATION_BUDGET.sessionBytes || typeof value.bindingHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.bindingHash))
                throw Error('shared_capacity_proposal');
            assertUnclaimed(value.operationId);
            const o = owner(token, true);
            assertResourceUnclaimed(o.producerKey, value.resourceId, value.generation);
            const tuple = { ...value, poolId, ...o }, encoded = json(tuple), tupleHash = hash(encoded), previous = row(value.operationId);
            if (previous) {
                if (previous.state === 'transferred')
                    throw Error('shared_capacity_transition');
                if (previous.tuple_hash !== tupleHash || previous.tuple_json !== encoded)
                    throw Error('shared_capacity_operation_conflict');
                return Object.freeze({ record: record(previous), created: false });
            }
            if (db.prepare('SELECT 1 FROM shared_capacity_reservations WHERE producer_key=? AND resource_id=? AND generation=?').get(o.producerKey, value.resourceId, value.generation))
                throw Error('shared_capacity_resource_conflict');
            assertCapacityStep();
            if (db.prepare('SELECT COUNT(*) n FROM shared_capacity_reservations').get().n >= 131072)
                throw Error('shared_capacity_record_capacity');
            const total = db.prepare("SELECT COALESCE(SUM(bytes),0) n FROM shared_capacity_reservations WHERE state<>'released' AND NOT EXISTS(SELECT 1 FROM shared_capacity_transfers WHERE operation_id=shared_capacity_reservations.operation_id)").get().n;
            const session = sessionUsage(o.sessionKey);
            const partition = db.prepare("SELECT COALESCE(SUM(bytes),0) n,COUNT(*) count FROM shared_capacity_reservations WHERE state<>'released' AND NOT EXISTS(SELECT 1 FROM shared_capacity_transfers WHERE operation_id=shared_capacity_reservations.operation_id) AND partition_name=?").get(value.partition);
            if (total + value.bytes > VERIFICATION_BUDGET.profileBytes)
                throw Error('shared_capacity_profile_capacity');
            if (session + value.bytes > VERIFICATION_BUDGET.sessionBytes)
                throw Error('shared_capacity_session_capacity');
            if (value.partition === 'counter') {
                const counters = db.prepare("SELECT session_key,SUM(bytes) bytes FROM shared_capacity_reservations WHERE state<>'released' AND NOT EXISTS(SELECT 1 FROM shared_capacity_transfers WHERE operation_id=shared_capacity_reservations.operation_id) AND partition_name='counter' GROUP BY session_key").all();
                const current = counters.find(row => row.session_key === o.sessionKey);
                if (counters.length > 64 || counters.some(row => row.bytes > 4 * MiB) || !current && counters.length >= 64 || (current?.bytes ?? 0) + value.bytes > 4 * MiB)
                    throw Error('shared_capacity_counter_owner_capacity');
            }
            if (partition.n + value.bytes > SHARED_CAPACITY_PARTITIONS[value.partition])
                throw Error('shared_capacity_partition_capacity');
            assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(encoded) + 2048 });
            db.prepare("INSERT INTO shared_capacity_reservations VALUES(?,?,?,?,?,?,?,?,?,'reserved',1,0)").run(value.operationId, o.sessionKey, o.producerKey, value.resourceId, value.generation, value.partition, value.bytes, tupleHash, encoded);
            const after = rawRow(value.operationId);
            const expected = { operation_id: value.operationId, session_key: o.sessionKey, producer_key: o.producerKey, resource_id: value.resourceId, generation: value.generation, partition_name: value.partition, bytes: value.bytes, tuple_hash: tupleHash, tuple_json: encoded, state: 'reserved', revision: 1, was_unknown: 0 };
            if (json(after) !== json(expected))
                throw Error('shared_capacity_replacement_changed');
            rememberRow(value.operationId, undefined, after);
            assertCapacityStep();
            return Object.freeze({ record: record(row(value.operationId)), created: true });
        }
        function attributeInTransaction(input) {
            assertCapacityStep();
            const physical = owned(input.physicalOwner, input.operationId), [physicalIdentity, beneficiary] = ownersCurrent([input.physicalOwner, input.beneficiaryOwner]);
            assertUnclaimed(input.operationId);
            if (physicalIdentity.sessionKey === beneficiary.sessionKey)
                throw Error('shared_capacity_attribution_same_session');
            if (!attributionPartitions.has(physical.partition_name))
                throw Error('shared_capacity_attribution_partition');
            assertCapacityStep();
            if (physical.state === 'transferred')
                throw Error('shared_capacity_attribution_released');
            const beforeAttributes = json(attributionSet(input.operationId));
            const old = readAttribution(physical, beneficiary);
            if (old)
                return Object.freeze({ record: old, created: false });
            if (physical.state === 'released')
                throw Error('shared_capacity_attribution_released');
            if (sessionUsage(beneficiary.sessionKey) + physical.bytes > VERIFICATION_BUDGET.sessionBytes)
                throw Error('shared_capacity_session_capacity');
            if (db.prepare('SELECT COUNT(*) n FROM shared_capacity_session_attributions').get().n >= 131072)
                throw Error('shared_capacity_attribution_capacity');
            const encoded = json(attributionTuple(physical, beneficiary));
            assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(encoded) + 2048 });
            db.prepare('INSERT INTO shared_capacity_session_attributions VALUES(?,?,?,?,?,?)').run(physical.operation_id, beneficiary.sessionKey, beneficiary.producerKey, physical.tuple_hash, encoded, hash(encoded));
            ownersCurrent([input.physicalOwner, input.beneficiaryOwner]);
            const after = owned(input.physicalOwner, input.operationId);
            if (json(record(after)) !== json(record(physical)))
                throw Error('shared_capacity_attribution_changed');
            const actual = readAttribution(after, beneficiary);
            if (!actual)
                throw Error('shared_capacity_attribution_changed');
            const expectedRow = { operation_id: physical.operation_id, beneficiary_session_key: beneficiary.sessionKey, beneficiary_producer_key: beneficiary.producerKey, physical_tuple_hash: physical.tuple_hash, attribution_json: encoded, attribution_hash: hash(encoded) };
            const expectedSet = JSON.parse(beforeAttributes).concat(expectedRow).sort((a, b) => Buffer.compare(Buffer.from(a.beneficiary_session_key), Buffer.from(b.beneficiary_session_key))), expectedAfter = json(expectedSet);
            if (json(attributionSet(input.operationId)) !== expectedAfter) {
                capacityPoisoned = true;
                throw Error('shared_capacity_replacement_changed');
            }
            const oldExpected = approvedAttributes.get(input.operationId);
            approvedAttributes.set(input.operationId, { before: oldExpected?.before ?? beforeAttributes, after: expectedAfter });
            assertCapacityStep();
            return Object.freeze({ record: actual, created: true });
        }
        function captureArray(raw, maximum) {
            if (types.isProxy(raw) || !Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype)
                throw Error('shared_capacity_batch');
            const length = Object.getOwnPropertyDescriptor(raw, 'length').value;
            if (length > maximum || Reflect.ownKeys(raw).length !== length + 1)
                throw Error('shared_capacity_batch');
            const captured = [];
            for (let i = 0; i < length; i++) {
                const descriptor = Object.getOwnPropertyDescriptor(raw, String(i));
                if (!descriptor || !('value' in descriptor))
                    throw Error('shared_capacity_batch');
                captured.push(descriptor.value);
            }
            return captured;
        }
        function metadataFields(raw, keys) { if (types.isProxy(raw))
            throw Error('shared_capacity_shape'); return fields(raw, keys); }
        function captureMetadata(entries) {
            const items = captureArray(entries, 16);
            if (!items.length)
                throw Error('shared_capacity_batch');
            let count = 0;
            return items.map(raw => {
                const item = metadataFields(raw, ['owner', 'proposal', 'beneficiaries']);
                const proposal = metadataFields(item.proposal, ['operationId', 'resourceId', 'generation', 'partition', 'bytes', 'bindingHash']);
                if (!attributionPartitions.has(proposal.partition))
                    throw Error('shared_capacity_attribution_partition');
                const beneficiaries = captureArray(item.beneficiaries, 131072 - count);
                count += beneficiaries.length;
                return { owner: item.owner, proposal, beneficiaries };
            });
        }
        function attributionSet(operationId) { return db.prepare('SELECT * FROM shared_capacity_session_attributions WHERE operation_id=? ORDER BY beneficiary_session_key').all(operationId); }
        const replacementPartitions = new Set(['control', 'rollback', 'outbox']);
        function captureReplacement(raw) {
            const value = metadataFields(raw, ['replacementId', 'intentId', 'sources', 'staging', 'unusedCapacity', 'targets', 'proof']);
            id(value.replacementId);
            id(value.intentId);
            if (!value.proof || typeof value.proof !== 'object' || types.isProxy(value.proof))
                throw Error('shared_capacity_replacement_proof');
            let count = 0;
            const take = (items, role) => captureArray(items, 131072 - count).map(raw => { count++; const item = metadataFields(raw, ['owner', 'operationId']); id(item.operationId); return { owner: item.owner, operationId: item.operationId, role }; });
            const old = [...take(value.sources, 'source'), ...take(value.staging, 'staging'), ...take(value.unusedCapacity, 'unused')];
            if (!old.length)
                throw Error('shared_capacity_replacement_empty');
            const targets = captureMetadata(value.targets);
            const ids = new Set();
            for (const id_ of [...old.map(v => v.operationId), ...targets.map(v => v.proposal.operationId)]) {
                id(id_);
                if (ids.has(id_))
                    throw Error('shared_capacity_replacement_duplicate');
                ids.add(id_);
            }
            return { replacementId: value.replacementId, intentId: value.intentId, old, targets, proof: value.proof };
        }
        function replacementFacts(input) {
            const sessions = new Map();
            const add = (value) => { const previous = sessions.get(value.sessionKey); if (previous !== undefined && previous !== value.producerKey)
                throw Error('shared_capacity_replacement_producer'); sessions.set(value.sessionKey, value.producerKey); };
            const old = input.old.map(member => {
                const physical = owner(member.owner, true), r = owned(member.owner, member.operationId);
                add(physical);
                if (!replacementPartitions.has(r.partition_name) || !(member.role === 'source' ? r.state === 'release_pending' : member.role === 'staging' ? r.state === 'committed' : ['reserved', 'committed'].includes(r.state)))
                    throw Error('shared_capacity_replacement_state');
                const attributions = attributionSet(member.operationId).map(a => { const value = a; const identity = { sessionKey: value.beneficiary_session_key, producerKey: value.beneficiary_producer_key }; add(identity); const row = readAttribution(r, identity); if (!row)
                    throw Error('shared_capacity_attribution_binding'); return row; });
                return { role: member.role, record: record(r), attributions };
            });
            const targetResources = new Set();
            const targets = input.targets.map(entry => { const p = entry.proposal; id(p.operationId); id(p.resourceId); if (!replacementPartitions.has(p.partition) || !Number.isSafeInteger(p.generation) || p.generation < 1 || !Number.isSafeInteger(p.bytes) || p.bytes < 1 || p.bytes > VERIFICATION_BUDGET.sessionBytes || typeof p.bindingHash !== 'string' || !/^[a-f0-9]{64}$/.test(p.bindingHash))
                throw Error('shared_capacity_proposal'); if (row(p.operationId) || db.prepare('SELECT 1 FROM shared_capacity_reservations WHERE producer_key=? AND resource_id=? AND generation=?').get(owner(entry.owner, true).producerKey, p.resourceId, p.generation))
                throw Error('shared_capacity_replacement_target_exists'); const physical = owner(entry.owner, true), resourceKey = json([physical.producerKey, p.resourceId, p.generation]); if (targetResources.has(resourceKey))
                throw Error('shared_capacity_resource_conflict'); targetResources.add(resourceKey); add(physical); const seen = new Set([physical.sessionKey]), beneficiaries = entry.beneficiaries.map(token => { const value = owner(token, true); if (seen.has(value.sessionKey))
                throw Error('shared_capacity_replacement_duplicate'); seen.add(value.sessionKey); add(value); return value; }); return { proposal: p, owner: physical, beneficiaries }; });
            for (const target of targets) {
                const actual = new Map([target.owner, ...target.beneficiaries].map(value => [value.sessionKey, value.producerKey]));
                if (actual.size !== sessions.size || [...sessions].some(([key, value]) => actual.get(key) !== value))
                    throw Error('shared_capacity_replacement_beneficiaries');
            }
            const facts = { poolId, authorityId, replacementId: input.replacementId, intentId: input.intentId, old, targets };
            assertMetadataReplacementFees(facts);
            function freeze(v) { if (v && typeof v === 'object') {
                for (const x of Object.values(v))
                    freeze(x);
                Object.freeze(v);
            } return v; }
            return freeze(facts);
        }
        function reserveMetadataEntries(raw) {
            const entries = captureMetadata(raw);
            return write(() => reserveMetadataEntriesInTransaction(entries));
        }
        function reserveMetadataEntriesInTransaction(entries, command) {
            if (!busy || !db.inTransaction)
                throw Error('capacity_metadata_transaction');
            const operations = new Set();
            const captured = entries.map(entry => {
                if (operations.has(entry.proposal.operationId))
                    throw Error('shared_capacity_metadata_duplicate');
                operations.add(entry.proposal.operationId);
                const [physical, ...beneficiaries] = ownersCurrent([entry.owner, ...entry.beneficiaries]), sessions = new Set();
                for (const identity of beneficiaries) {
                    if (identity.sessionKey === physical.sessionKey)
                        throw Error('shared_capacity_attribution_same_session');
                    if (sessions.has(identity.sessionKey))
                        throw Error('shared_capacity_metadata_duplicate');
                    sessions.add(identity.sessionKey);
                }
                const allocation = reserveInTransaction(entry.owner, entry.proposal);
                if (!['reserved', 'committed'].includes(allocation.record.state))
                    throw Error('shared_capacity_metadata_state');
                if (attributionSet(entry.proposal.operationId).some(row => !sessions.has(row.beneficiary_session_key)))
                    throw Error('shared_capacity_metadata_beneficiaries');
                const attributions = Object.freeze(entry.beneficiaries.map(beneficiaryOwner => attributeInTransaction({ physicalOwner: entry.owner, beneficiaryOwner, operationId: entry.proposal.operationId })));
                return { entry, result: Object.freeze({ allocation, attributions }), fullSet: json(attributionSet(entry.proposal.operationId)) };
            });
            const results = Object.freeze(captured.map(item => item.result));
            if (command) {
                const context = Object.freeze({}), entry = { ledger, database: db, command, allocations: results, used: false };
                metadataCommandContexts.set(context, entry);
                try {
                    assertCapacityStep();
                    executeCapacityMetadataCommand(command, context);
                    assertCapacityStep();
                    if (!entry.used)
                        throw Error('capacity_metadata_command_context');
                }
                finally {
                    metadataCommandContexts.delete(context);
                }
            }
            for (const { entry, result, fullSet } of captured) {
                ownersCurrent([entry.owner, ...entry.beneficiaries]);
                if (json(record(owned(entry.owner, entry.proposal.operationId))) !== json(result.allocation.record) || json(attributionSet(entry.proposal.operationId)) !== fullSet)
                    throw Error('shared_capacity_commit_changed');
            }
            return results;
        }
        function assertSharedCaptured(fact) { for (const entry of fact.captured) {
            owner(entry.owner, true);
            if (json(record(owned(entry.owner, entry.record.operationId))) !== json(entry.record))
                throw Error('shared_capacity_commit_changed');
        } }
        function invokeSharedCommand(command, kind) {
            const context = Object.freeze({}), fact = { ledger, database: db, command, kind, used: false, batchUsed: false, poisoned: false, captured: [] };
            sharedCommandContexts.set(context, fact);
            try {
                assertCapacityStep();
                executeSharedCapacityCommand(command, context);
                assertCapacityStep();
                if (!fact.used)
                    throw Error('shared_capacity_command_context');
                if (fact.poisoned)
                    throw Error('shared_capacity_transaction_poisoned');
                assertSharedCaptured(fact);
                identity();
                if (!db.inTransaction)
                    throw Error('shared_capacity_transaction');
            }
            finally {
                sharedCommandContexts.delete(context);
            }
        }
        const consumedMetadataCommands = new WeakSet();
        const ledger = Object.freeze({
            reserveCommand(command) {
                if (arguments.length !== 1)
                    throw Error('shared_capacity_command_shape');
                const facts = inspectSharedCapacityCommand(command, ledger, db);
                if (facts.kind === 'batch')
                    throw Error('shared_capacity_command_context');
                if (consumedMetadataCommands.has(command))
                    throw Error('shared_capacity_command_consumed');
                consumedMetadataCommands.add(command);
                return write(() => {
                    if (facts.kind === 'import') {
                        const entries = captureArray(facts.entries, 131072);
                        if (Buffer.byteLength(json(entries.map(e => e.proposal))) > 128 * MiB)
                            throw Error('shared_capacity_migration_limit');
                        const captured = entries.map(raw => { const entry = metadataFields(raw, ['owner', 'proposal']), token = entry.owner, proposal = metadataFields(entry.proposal, ['operationId', 'resourceId', 'generation', 'partition', 'bytes', 'bindingHash']); return { owner: token, allocation: reserveInTransaction(token, proposal) }; });
                        const before = replacementDigest();
                        invokeSharedCommand(command, 'import');
                        if (replacementDigest() !== before)
                            throw Error('shared_capacity_replacement_changed');
                        for (const item of captured) {
                            owner(item.owner, true);
                            if (json(record(owned(item.owner, item.allocation.record.operationId))) !== json(item.allocation.record))
                                throw Error('shared_capacity_commit_changed');
                        }
                        return;
                    }
                    if (facts.kind === 'transaction') {
                        const before = replacementDigest();
                        invokeSharedCommand(command, facts.kind);
                        if (replacementDigest() !== before)
                            throw Error('shared_capacity_replacement_changed');
                        return;
                    }
                    if (facts.kind !== 'unallocated-release')
                        owner(facts.owner, true);
                    let releasing;
                    if (facts.kind === 'release' && facts.proposal.bytes > 0) {
                        releasing = owned(facts.owner, facts.proposal.operationId);
                        assertUnclaimed(releasing.operation_id);
                        if (releasing.state === 'released')
                            return record(releasing);
                        if (releasing.state !== 'release_pending')
                            throw Error('shared_capacity_transition');
                        synchronous(assertReleased(facts.receipt, record(releasing)));
                    }
                    const allocation = facts.kind === 'reserve' && facts.proposal.bytes > 0 ? reserveInTransaction(facts.owner, facts.proposal) : undefined, before = replacementDigest();
                    invokeSharedCommand(command, facts.kind);
                    if (replacementDigest() !== before)
                        throw Error('shared_capacity_replacement_changed');
                    if (facts.kind !== 'unallocated-release')
                        owner(facts.owner, true);
                    if (allocation && json(record(owned(facts.owner, allocation.record.operationId))) !== json(allocation.record))
                        throw Error('shared_capacity_commit_changed');
                    if (releasing) {
                        const after = owned(facts.owner, releasing.operation_id);
                        if (after.state !== releasing.state || after.revision !== releasing.revision || after.tuple_hash !== releasing.tuple_hash || after.tuple_json !== releasing.tuple_json)
                            throw Error('shared_capacity_release_changed');
                        return update(after, 'released');
                    }
                    return allocation;
                });
            },
            reserveBatchCommand(command, parentContext) {
                const parent = sharedCommandContexts.get(parentContext);
                try {
                    if (arguments.length !== 2 || !parent || parent.ledger !== ledger || parent.database !== db || parent.kind !== 'transaction' || !parent.used || parent.batchUsed || !busy || !db.inTransaction)
                        throw Error('shared_capacity_command_context');
                    parent.batchUsed = true;
                    const facts = inspectSharedCapacityCommand(command, ledger, db);
                    if (facts.kind !== 'batch')
                        throw Error('shared_capacity_command_context');
                    if (consumedMetadataCommands.has(command))
                        throw Error('shared_capacity_command_consumed');
                    consumedMetadataCommands.add(command);
                    const entries = captureArray(facts.entries, 16);
                    if (!entries.length)
                        throw Error('shared_capacity_batch');
                    for (const raw of entries) {
                        const entry = metadataFields(raw, ['owner', 'proposal']), token = entry.owner, proposal = metadataFields(entry.proposal, ['operationId', 'resourceId', 'generation', 'partition', 'bytes', 'bindingHash']);
                        const allocation = reserveInTransaction(token, proposal);
                        parent.captured.push({ owner: token, record: allocation.record });
                    }
                    const before = replacementDigest();
                    invokeSharedCommand(command, 'batch');
                    if (replacementDigest() !== before)
                        throw Error('shared_capacity_replacement_changed');
                    assertSharedCaptured(parent);
                }
                catch (error) {
                    if (parent && parent.ledger === ledger && parent.database === db)
                        parent.poisoned = true;
                    throw error;
                }
            },
            reserveMetadata(raw) { if (arguments.length !== 1)
                throw Error('capacity_metadata_callback_forbidden'); return reserveMetadataEntries(raw); },
            reserveMetadataCommand(command) {
                if (arguments.length !== 1)
                    throw Error('capacity_metadata_callback_forbidden');
                return write(() => {
                    if (consumedMetadataCommands.has(command))
                        throw Error('capacity_metadata_command_consumed');
                    // Fixed dispatch observes the same original SQLite snapshot as allocation
                    // and consumption; no caller-provided callback enters this transaction.
                    const facts = inspectCapacityMetadataCommand(command, ledger, db);
                    consumedMetadataCommands.add(command);
                    return reserveMetadataEntriesInTransaction(captureMetadata(facts.entries), command);
                });
            },
            prepareMetadataReplacement(raw) {
                if (arguments.length !== 1)
                    throw Error('shared_capacity_replacement_arguments');
                const input = captureReplacement(raw);
                return write(() => {
                    if (typeof assertMetadataReplacement !== 'function')
                        throw Error('shared_capacity_replacement_unavailable');
                    const facts = replacementFacts(input), encoded = json(facts), requestHash = hash(encoded);
                    synchronous(assertMetadataReplacement(input.proof, facts));
                    if (json(replacementFacts(input)) !== encoded)
                        throw Error('shared_capacity_replacement_changed');
                    const previous = db.prepare('SELECT * FROM shared_metadata_replacements WHERE replacement_id=?').get(input.replacementId);
                    const result = Object.freeze({ replacementId: input.replacementId, intentId: input.intentId, requestHash, state: 'prepared' });
                    const claims = [...input.old.map(v => ({ operationId: v.operationId, role: v.role })), ...input.targets.map(v => ({ operationId: v.proposal.operationId, role: 'target' }))].sort((a, b) => Buffer.compare(Buffer.from(a.operationId), Buffer.from(b.operationId)));
                    const resources = facts.targets.map(v => ({ producer_key: v.owner.producerKey, resource_id: v.proposal.resourceId, generation: v.proposal.generation, operation_id: v.proposal.operationId, replacement_id: input.replacementId })).sort((a, b) => Buffer.compare(Buffer.from(a.operation_id), Buffer.from(b.operation_id)));
                    function assertPrepared() { const actualReplacement = db.prepare('SELECT * FROM shared_metadata_replacements WHERE replacement_id=?').get(input.replacementId); if (json(actualReplacement ?? null) !== json({ replacement_id: input.replacementId, intent_id: input.intentId, request_hash: requestHash, request_json: encoded, state: 'prepared' }))
                        throw Error('shared_capacity_replacement_changed'); const actual = db.prepare("SELECT operation_id,role FROM shared_metadata_replacement_claims WHERE replacement_id=? AND role='target' UNION ALL SELECT operation_id,role FROM shared_metadata_replacement_consumptions WHERE replacement_id=? ORDER BY operation_id").all(input.replacementId, input.replacementId); if (json(actual) !== json(claims.map(v => ({ operation_id: v.operationId, role: v.role }))))
                        throw Error('shared_capacity_replacement_changed'); if (json(db.prepare('SELECT * FROM shared_metadata_replacement_resource_claims WHERE replacement_id=? ORDER BY operation_id').all(input.replacementId)) !== json(resources))
                        throw Error('shared_capacity_replacement_changed'); }
                    if (previous) {
                        if (previous.intent_id !== input.intentId || previous.request_hash !== requestHash || previous.request_json !== encoded || previous.state !== 'prepared')
                            throw Error('shared_capacity_replacement_conflict');
                        assertPrepared();
                        return result;
                    }
                    const tables = ['shared_metadata_replacements', 'shared_metadata_replacement_claims', 'shared_metadata_replacement_resource_claims'], count = () => tables.map(table => db.prepare('SELECT COUNT(*) n FROM ' + table).get().n), originalCounts = count(), expectedCounts = originalCounts.map((n, i) => n + [1, claims.filter(v => !db.prepare('SELECT 1 FROM shared_metadata_replacement_claims WHERE operation_id=?').get(v.operationId)).length, resources.length][i]);
                    function assertNewPopulation() { assertPrepared(); if (json(count()) !== json(expectedCounts))
                        throw Error('shared_capacity_replacement_changed'); }
                    for (const resource of resources)
                        assertResourceUnclaimed(resource.producer_key, resource.resource_id, resource.generation);
                    for (const claim of claims) {
                        assertUnclaimed(claim.operationId);
                        const existing = db.prepare('SELECT * FROM shared_metadata_replacement_claims WHERE operation_id=?').get(claim.operationId);
                        if (existing && !(claim.role !== 'target' && existing.role === 'target' && committedReplacement(existing.replacement_id)))
                            throw Error('shared_capacity_replacement_conflict');
                        if (claim.role !== 'target' && db.prepare('SELECT 1 FROM shared_metadata_replacement_consumptions WHERE operation_id=?').get(claim.operationId))
                            throw Error('shared_capacity_replacement_conflict');
                    }
                    if (db.prepare('SELECT COUNT(*) n FROM shared_metadata_replacement_claims').get().n + claims.length > 131072)
                        throw Error('shared_capacity_replacement_capacity');
                    assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(encoded) + claims.reduce((n, v) => n + Buffer.byteLength(v.operationId) + Buffer.byteLength(input.replacementId) + 2048, 8192) });
                    insertPreparedRow('shared_metadata_replacements', { replacement_id: input.replacementId, intent_id: input.intentId, request_hash: requestHash, request_json: encoded, state: 'prepared' }, () => { db.prepare("INSERT INTO shared_metadata_replacements VALUES(?,?,?,?,'prepared')").run(input.replacementId, input.intentId, requestHash, encoded); });
                    const claim = db.prepare('INSERT INTO shared_metadata_replacement_claims VALUES(?,?,?)');
                    for (const v of claims) {
                        const expected = { operation_id: v.operationId, replacement_id: input.replacementId, role: v.role };
                        if (!db.prepare('SELECT 1 FROM shared_metadata_replacement_claims WHERE operation_id=?').get(v.operationId))
                            insertPreparedRow('shared_metadata_replacement_claims', expected, () => { claim.run(v.operationId, input.replacementId, v.role); });
                        if (v.role !== 'target')
                            insertPreparedRow('shared_metadata_replacement_consumptions', expected, () => { db.prepare('INSERT INTO shared_metadata_replacement_consumptions VALUES(?,?,?)').run(v.operationId, input.replacementId, v.role); });
                    }
                    const resourceClaim = db.prepare('INSERT INTO shared_metadata_replacement_resource_claims VALUES(?,?,?,?,?)');
                    for (const v of resources)
                        insertPreparedRow('shared_metadata_replacement_resource_claims', v, () => { resourceClaim.run(v.producer_key, v.resource_id, v.generation, v.operation_id, v.replacement_id); });
                    assertNewPopulation();
                    const before = replacementDigest();
                    synchronous(assertMetadataReplacement(input.proof, facts));
                    assertNewPopulation();
                    if (replacementDigest() !== before || json(replacementFacts(input)) !== encoded)
                        throw Error('shared_capacity_replacement_changed');
                    return result;
                });
            },
            commitMetadataReplacement(raw, proof) {
                if (arguments.length !== 2)
                    throw Error('shared_capacity_replacement_arguments');
                const input = captureReplacement(raw);
                if (!proof || typeof proof !== 'object' || types.isProxy(proof))
                    throw Error('shared_capacity_replacement_proof');
                return write(() => {
                    const p = db.prepare('SELECT * FROM shared_metadata_replacements WHERE replacement_id=?').get(input.replacementId);
                    if (!p || p.intent_id !== input.intentId)
                        throw Error('shared_capacity_replacement_preparation');
                    const facts = freezeReplacement(JSON.parse(p.request_json));
                    const requested = { poolId, authorityId, replacementId: input.replacementId, intentId: input.intentId, old: input.old.map(member => ({ role: member.role, operationId: member.operationId, owner: owner(member.owner, true) })), targets: input.targets.map(t => ({ proposal: t.proposal, owner: owner(t.owner, true), beneficiaries: t.beneficiaries.map(b => owner(b, true)) })) };
                    const expected = { poolId, authorityId, replacementId: facts.replacementId, intentId: facts.intentId, old: facts.old.map(member => ({ role: member.role, operationId: member.record.operationId, owner: { sessionKey: member.record.sessionKey, producerKey: member.record.producerKey } })), targets: facts.targets };
                    if (json(requested) !== json(expected) || hash(p.request_json) !== p.request_hash)
                        throw Error('shared_capacity_replacement_conflict');
                    assertMetadataReplacementFees(facts);
                    synchronous(assertInstalledCapacityReplacementCommit(authority, proof, facts));
                    const prior = db.prepare('SELECT result_json FROM shared_metadata_replacement_commits WHERE replacement_id=?').get(input.replacementId);
                    if (prior) {
                        synchronous(assertInstalledCapacityReplacementCommit(authority, proof, facts));
                        return freezeReplacement(JSON.parse(prior.result_json));
                    }
                    if (json(replacementFacts(input)) !== p.request_json)
                        throw Error('shared_capacity_replacement_changed');
                    const schema = sqlSchemaDigest(), population = metadataPopulationCounts(), requestPopulation = preparedHistoryDigest();
                    assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(p.request_json) * 2 + facts.old.length * 4096 + facts.targets.reduce((n, t) => n + (t.beneficiaries.length + 1) * 4096, 16384) });
                    const sequence = db.prepare('SELECT COALESCE(MAX(commit_sequence),0) n FROM shared_metadata_replacement_commits').get().n + 1;
                    if (!Number.isSafeInteger(sequence))
                        throw Error('shared_capacity_replacement_capacity');
                    activeReplacement = input.replacementId;
                    try {
                        for (const old of facts.old) {
                            const original = row(old.record.operationId);
                            if (old.role === 'source')
                                update(original, 'released');
                            else {
                                assertCapacityStep();
                                const expected = { operation_id: old.record.operationId, state: 'transferred', replacement_id: input.replacementId, tuple_hash: original.tuple_hash, revision: original.revision + 1 };
                                db.prepare("INSERT INTO shared_capacity_transfers VALUES(?,'transferred',?,?,?)").run(old.record.operationId, input.replacementId, original.tuple_hash, original.revision + 1);
                                const actual = db.prepare('SELECT * FROM shared_capacity_transfers WHERE operation_id=?').get(old.record.operationId);
                                if (json(actual) !== json(expected)) {
                                    capacityPoisoned = true;
                                    throw Error('shared_capacity_replacement_changed');
                                }
                                expectedTransfers.set(old.record.operationId, expected);
                                approvedTransfers.add(old.record.operationId);
                                assertCapacityStep();
                            }
                        }
                        const targets = input.targets.map(entry => { const allocation = reserveInTransaction(entry.owner, entry.proposal); if (!allocation.created)
                            throw Error('shared_capacity_replacement_target_exists'); const attributions = entry.beneficiaries.map(beneficiaryOwner => attributeInTransaction({ physicalOwner: entry.owner, beneficiaryOwner, operationId: entry.proposal.operationId }).record); if (entry.proposal.partition !== 'rollback')
                            update(row(entry.proposal.operationId), 'committed'); return { record: record(row(entry.proposal.operationId)), attributions }; });
                        const old = facts.old.map(item => ({ role: item.role, record: record(row(item.record.operationId)), attributions: item.attributions.map(a => ({ ...a, charged: false })) }));
                        const core = { replacementId: input.replacementId, intentId: input.intentId, requestHash: p.request_hash, state: 'committed', commitSequence: sequence, old, targets }, result = freezeReplacement({ ...core, resultHash: metadataReplacementResultHash(core) });
                        const expectedCommit = { replacement_id: input.replacementId, commit_sequence: sequence, intent_id: input.intentId, request_hash: p.request_hash, result_json: json(result), result_hash: result.resultHash };
                        db.prepare('INSERT INTO shared_metadata_replacement_commits VALUES(?,?,?,?,?,?)').run(input.replacementId, sequence, input.intentId, p.request_hash, expectedCommit.result_json, result.resultHash);
                        const actualCommit = db.prepare('SELECT * FROM shared_metadata_replacement_commits WHERE replacement_id=?').get(input.replacementId);
                        if (json(actualCommit) !== json(expectedCommit)) {
                            capacityPoisoned = true;
                            throw Error('shared_capacity_replacement_changed');
                        }
                        expectedCommitRow = expectedCommit;
                        approvedCommit = input.replacementId;
                        assertCapacityStep();
                        const counts = metadataPopulationCounts();
                        if (json(counts) !== json(population.map((v, i) => v + [0, 0, 0, 1, facts.old.filter(o => o.role !== 'source').length, 0, facts.targets.length, facts.targets.reduce((n, t) => n + t.beneficiaries.length, 0)][i])))
                            throw Error('shared_capacity_replacement_changed');
                        if (sqlSchemaDigest() !== schema || preparedHistoryDigest() !== requestPopulation)
                            throw Error('shared_capacity_replacement_changed');
                        assertMetadataReplacementLineage(db, poolId, authorityId);
                        const complete = replacementDigest(), completeCapacity = capacityStateDigest(), context = Object.freeze({}), contextFacts = { ledger, database: db, proof, result, used: false };
                        replacementCommitContexts.set(context, contextFacts);
                        try {
                            synchronous(executeInstalledCapacityReplacementCommit(authority, proof, context));
                            if (!contextFacts.used)
                                throw Error('shared_capacity_replacement_context');
                        }
                        finally {
                            replacementCommitContexts.delete(context);
                        }
                        synchronous(assertInstalledCapacityReplacementCommit(authority, proof, facts));
                        for (const member of input.old)
                            owner(member.owner, true);
                        for (const entry of input.targets) {
                            owner(entry.owner, true);
                            for (const b of entry.beneficiaries)
                                owner(b, true);
                        }
                        if (capacityStateDigest() !== completeCapacity || replacementDigest() !== complete || json(metadataPopulationCounts()) !== json(counts) || preparedHistoryDigest() !== requestPopulation || sqlSchemaDigest() !== schema)
                            throw Error('shared_capacity_replacement_changed');
                        return result;
                    }
                    finally {
                        activeReplacement = undefined;
                    }
                });
            },
            attributeSession(raw) { if (arguments.length !== 1)
                throw Error('shared_capacity_arguments'); const input = attributionInput(raw); return write(() => attributeInTransaction(input)); },
            querySessionAttribution(raw) { if (arguments.length !== 1)
                throw Error('shared_capacity_arguments'); const input = attributionInput(raw); return readSnapshot(() => { const physical = owned(input.physicalOwner, input.operationId), beneficiary = owner(input.beneficiaryOwner); return readAttribution(physical, beneficiary); }); },
            bindOwner(binding) { if (arguments.length !== 1)
                throw Error('shared_capacity_arguments'); identity(); synchronous(assertCurrent()); if (!binding || typeof binding !== 'object')
                throw Error('shared_capacity_owner'); const fixed = ownerIdentity(binding), token = Object.freeze({}); owners.set(token, { binding, identity: fixed }); return token; },
            reserve(token, raw) { if (arguments.length !== 2)
                throw Error('shared_capacity_arguments'); const proposal = fields(raw, ['operationId', 'resourceId', 'generation', 'partition', 'bytes', 'bindingHash']); return write(() => reserveInTransaction(token, proposal)); },
            commit(token, operationId) { if (arguments.length !== 2)
                throw Error('shared_capacity_arguments'); return transition(token, operationId, 'committed', ['reserved']); },
            requestRelease(token, operationId) { if (arguments.length !== 2)
                throw Error('shared_capacity_arguments'); return transition(token, operationId, 'release_pending', ['reserved', 'committed', 'unknown']); },
            markUnknown(token, operationId) { if (arguments.length !== 2)
                throw Error('shared_capacity_arguments'); return transition(token, operationId, 'unknown', ['reserved', 'committed', 'release_pending']); },
            release(token, operationId, receipt) { if (arguments.length !== 3)
                throw Error('shared_capacity_arguments'); return write(() => { const before = owned(token, operationId); assertUnclaimed(operationId); if (before.state === 'released')
                return record(before); if (before.state !== 'release_pending')
                throw Error('shared_capacity_transition'); synchronous(assertReleased(receipt, record(before))); const after = owned(token, operationId); if (after.state !== before.state || after.revision !== before.revision || after.tuple_hash !== before.tuple_hash || after.tuple_json !== before.tuple_json)
                throw Error('shared_capacity_release_changed'); return update(after, 'released'); }); },
            query(token, operationId) { if (arguments.length !== 2)
                throw Error('shared_capacity_arguments'); return readSnapshot(() => { const o = owner(token); const r = row(operationId); if (!r)
                return undefined; if (r.session_key !== o.sessionKey || r.producer_key !== o.producerKey)
                throw Error('shared_capacity_operation'); return record(r); }); },
            usage() { if (arguments.length !== 0)
                throw Error('shared_capacity_arguments'); return readSnapshot(() => { const rows = db.prepare("SELECT partition_name,COALESCE(SUM(bytes),0) n FROM shared_capacity_reservations WHERE state<>'released' AND NOT EXISTS(SELECT 1 FROM shared_capacity_transfers WHERE operation_id=shared_capacity_reservations.operation_id) GROUP BY partition_name").all(); return Object.freeze({ chargedBytes: rows.reduce((sum, r) => sum + r.n, 0), partitions: Object.freeze(Object.fromEntries(rows.map(r => [r.partition_name, r.n]))) }); }); },
            close() { if (arguments.length !== 0)
                throw Error('shared_capacity_arguments'); lifetime.closed = true; },
        });
        ledgerIdentities.set(ledger, { database: db, authorityId, authority, state: lifetime });
        finishInstalledCapacityLayer(authority, 'ledger', ledger);
        return ledger;
    }
    catch (error) {
        failInstalledCapacityLayer(authority, 'ledger');
        throw error;
    }
}
