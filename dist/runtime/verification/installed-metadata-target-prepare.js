import { createHash, randomUUID } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, lstatSync, writeSync, readSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { assertInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { assertInstalledCapacityAuthorityLifetime, readInstalledCapacityAuthority, readInstalledCapacityLayer } from './installed-controller.js';
import { assertInstalledMetadataClosureCapture, readInstalledMetadataClosure, checkInstalledMetadataClosure } from './installed-metadata-closure.js';
import { readInstalledProfileSourceCapture } from './profile-source-capture.js';
import { createInstalledMetadataCapacity } from './installed-metadata-capacity.js';
import { consumeCapacityMetadataContext } from './shared-capacity-ledger.js';
import { assertVerificationDatabaseBudget, isVerificationHeadroomNotReady, runVerificationTransaction } from './storage-budget.js';
import { isInstalledMetadataMappingNotReady } from './installed-metadata-source.js';
import { countBoundedProfileCaptureJson, encodeBoundedProfileCaptureJson } from './profile-capture-json.js';
import { canonicalVerificationJson as json, VERIFICATION_BUDGET } from './protocol.js';
const BLOCK = 16 * 1024 ** 2, LIMIT = 128 * 1024 ** 2;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const schema = [
    'CREATE TABLE metadata_prepare_archive_intents(id INTEGER PRIMARY KEY,intent_id TEXT UNIQUE NOT NULL,capture_key TEXT UNIQUE NOT NULL,record_json TEXT NOT NULL,fee_state TEXT NOT NULL CHECK(fee_state=\'pending-unknown\'))',
    'CREATE TABLE metadata_prepare_archive_slots(intent_rowid INTEGER PRIMARY KEY REFERENCES metadata_prepare_archive_intents(id),stage_valid INTEGER NOT NULL CHECK(stage_valid=0),ready INTEGER NOT NULL CHECK(ready=0),stage_payload BLOB NOT NULL CHECK(typeof(stage_payload)=\'blob\' AND length(stage_payload)=65536),ready_payload BLOB NOT NULL CHECK(typeof(ready_payload)=\'blob\' AND length(ready_payload)=65536))',
];
const bindings = new WeakMap();
function groupCurrent(group) { assertInstalledCapacityAuthorityLifetime(group.authority, group.lifetime); assertInstalledMetadataClosureCapture(group.lifetime, group.closure, group.owner, group.token); if (readInstalledMetadataClosure(group.lifetime, group.closure) !== group.facts)
    throw Error('metadata_prepare_closure_changed'); }
/** Undefined means a foreign brand, not permission to mint an arbitrary owner. */
export function inspectMetadataPreparationOwner(binding) { return bindings.has(binding); }
export function readMetadataPreparationOwners(authority, handles) {
    const groups = new Set(), found = handles.map(handle => { const f = bindings.get(handle); if (!f || f.group.authority !== authority)
        throw Error('metadata_prepare_owner_brand'); groups.add(f.group); return f; });
    for (const group of groups)
        groupCurrent(group);
    const result = Object.freeze(found.map(f => f.identity));
    for (const group of groups)
        groupCurrent(group);
    return result;
}
const commands = new WeakMap();
const failedFactories = new Set();
function exactSchema(db) {
    for (const sql of schema) {
        const table = sql.split('(')[0].slice('CREATE TABLE '.length), row = db.prepare('SELECT sql FROM main.sqlite_master WHERE type=\'table\' AND name=?').get(table);
        if (row?.sql !== sql)
            throw Error('metadata_prepare_schema');
        const extras = db.prepare('SELECT type,name,sql FROM main.sqlite_master WHERE tbl_name=? AND type IN (\'trigger\',\'index\') ORDER BY name').all(table);
        if (extras.some(r => r.type === 'trigger' || r.sql !== null) || extras.length !== (table === 'metadata_prepare_archive_intents' ? 2 : 0))
            throw Error('metadata_prepare_schema');
    }
}
export function inspectMetadataArchivePrepareCommand(command, ledger, database) { const f = commands.get(command); if (!f)
    return undefined; if (f.ledger !== ledger || f.database !== database)
    throw Error('metadata_prepare_command_owner'); f.current(); return Object.freeze({ entries: f.entries }); }
export function executeMetadataArchivePrepareCommand(command, context) {
    const f = commands.get(command);
    if (!f)
        return false;
    f.current();
    exactSchema(f.database);
    const fees = consumeCapacityMetadataContext(context, f.ledger, f.database, command);
    if (fees.length !== f.entries.length)
        throw Error('metadata_prepare_fees');
    assertVerificationDatabaseBudget(f.database, { additionalBytes: Buffer.byteLength(f.record) + 2 * 65536 + 16384 });
    const row = f.database.prepare("INSERT INTO metadata_prepare_archive_intents(intent_id,capture_key,record_json,fee_state) VALUES(?,?,?,'pending-unknown')").run(f.intentId, f.captureKey, f.record), id = Number(row.lastInsertRowid);
    if (!Number.isSafeInteger(id) || id < 1)
        throw Error('metadata_prepare_rowid');
    f.database.prepare('INSERT INTO metadata_prepare_archive_slots VALUES(?,0,0,zeroblob(65536),zeroblob(65536))').run(id);
    f.current();
    exactSchema(f.database);
    f.result = id;
    return true;
}
const entries = new WeakMap();
function inode(fd) { const stat = fstatSync(fd, { bigint: true }); return { stat, identity: json({ device: String(stat.dev), inode: String(stat.ino), uid: String(stat.uid), mode: String(stat.mode), nlink: String(stat.nlink) }) }; }
/** Actual installed authority only. This archives observations; it never emits
 * stage-valid, retirement, replacement or ready/adopt authority. */
export function createInstalledMetadataTargetPreparation(lifetime, authority) {
    if (arguments.length !== 2)
        throw Error('metadata_prepare_arguments');
    assertInstalledControllerLifetime(lifetime);
    assertInstalledCapacityAuthorityLifetime(authority, lifetime);
    const { database: db, authorityId } = readInstalledCapacityAuthority(authority), ledger = readInstalledCapacityLayer(authority, 'ledger'), shared = readInstalledCapacityLayer(authority, 'installed-owner');
    let metadata;
    const owned = new Set(), admitted = new WeakSet();
    let initialization = 'new', initializationError, initializationFees;
    let closing = false, pending, dirFD, dirIdentity, closePromise;
    function current() { if (closing)
        throw Error('metadata_prepare_closed'); assertInstalledControllerLifetime(lifetime); assertInstalledCapacityAuthorityLifetime(authority, lifetime); if (readInstalledCapacityAuthority(authority).database !== db)
        throw Error('metadata_prepare_database'); }
    function directory() { if (dirFD === undefined) {
        dirFD = openSync(lifetime.state, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const f = inode(dirFD);
        dirIdentity = json({ device: String(f.stat.dev), inode: String(f.stat.ino), uid: String(f.stat.uid), mode: String(f.stat.mode) });
        if (!f.stat.isDirectory() || f.stat.uid !== BigInt(lifetime.manifest.serviceUid) || (f.stat.mode & 63n) !== 0n)
            throw Error('metadata_prepare_directory');
    } const held = inode(dirFD), path = lstatSync(lifetime.state, { bigint: true }); if (json({ device: String(held.stat.dev), inode: String(held.stat.ino), uid: String(held.stat.uid), mode: String(held.stat.mode) }) !== dirIdentity || path.isSymbolicLink() || !path.isDirectory() || path.dev !== held.stat.dev || path.ino !== held.stat.ino)
        throw Error('metadata_prepare_directory_changed'); return dirFD; }
    function checkEntry(e) { current(); groupCurrent(e.group); exactSchema(db); const row = db.prepare('SELECT record_json,fee_state FROM metadata_prepare_archive_intents WHERE id=?').get(e.rowid); if (row?.record_json !== e.record || row.fee_state !== 'pending-unknown')
        throw Error('metadata_prepare_intent_changed'); const slot = db.prepare('SELECT stage_valid,ready,stage_payload,ready_payload,length(stage_payload) stage_bytes,length(ready_payload) ready_bytes FROM metadata_prepare_archive_slots WHERE intent_rowid=?').get(e.rowid); if (!slot || slot.stage_valid !== 0 || slot.ready !== 0 || slot.stage_bytes !== 65536 || slot.ready_bytes !== 65536 || slot.stage_payload.some(byte => byte !== 0) || slot.ready_payload.some(byte => byte !== 0))
        throw Error('metadata_prepare_slot_changed'); if (e.closed || e.fd === undefined)
        throw Error('metadata_prepare_entry_closed'); directory(); const f = inode(e.fd), path = lstatSync(e.path, { bigint: true }); if (f.identity !== e.identity || !f.stat.isFile() || path.isSymbolicLink() || path.dev !== f.stat.dev || path.ino !== f.stat.ino || f.stat.nlink !== 1n || f.stat.uid !== BigInt(lifetime.manifest.serviceUid))
        throw Error('metadata_prepare_file_changed'); if (Number(f.stat.size) !== e.diagnostics.fileBytes)
        throw Error('metadata_prepare_file_changed'); const buffer = Buffer.allocUnsafe(Math.min(65536, e.diagnostics.fileBytes)), hash = createHash('sha256'); try {
        for (let offset = 0; offset < e.diagnostics.fileBytes;) {
            const n = readSync(e.fd, buffer, 0, Math.min(buffer.length, e.diagnostics.fileBytes - offset), offset);
            if (n < 1)
                throw Error('metadata_prepare_partial');
            hash.update(buffer.subarray(0, n));
            offset += n;
        }
        if (hash.digest('hex') !== e.fileHash)
            throw Error('metadata_prepare_hash');
    }
    finally {
        buffer.fill(0);
    } }
    function closeActual(e) { if (e.closed)
        return; if (e.fd !== undefined) {
        if (e.identity) {
            const expected = JSON.parse(e.identity), actual = fstatSync(e.fd, { bigint: true });
            if (String(actual.dev) !== expected.device || String(actual.ino) !== expected.inode)
                throw Error('metadata_prepare_close_identity');
        }
        closeSync(e.fd);
        e.fd = undefined;
    } e.closed = true; owned.delete(e); }
    async function prepare(owner, token, closure, signal) {
        current();
        if (initialization !== 'ready')
            throw Error('metadata_prepare_unavailable', { cause: initializationError });
        signal.throwIfAborted();
        if (admitted.has(closure) || db.inTransaction)
            throw Error('metadata_prepare_pending');
        assertInstalledMetadataClosureCapture(lifetime, closure, owner, token);
        admitted.add(closure);
        let e, buffer, charged = false;
        try {
            await checkInstalledMetadataClosure(lifetime, closure);
            current();
            signal.throwIfAborted();
            const capture = readInstalledProfileSourceCapture(lifetime, owner, token), facts = readInstalledMetadataClosure(lifetime, closure), set = capture.review.sourceSet;
            const group = { lifetime, authority, owner, token, closure, facts };
            groupCurrent(group);
            if (facts.native.profiles.some(p => p.uid !== set.uid || p.accountId !== set.accountId || p.profileId !== set.profileId))
                throw Error('metadata_prepare_profile');
            const sessions = new Map(), known = Array.from(new Map([...facts.sources.flatMap(s => s.sessions), ...facts.entities.flatMap(s => s.sessions), ...facts.nativeOwners.flatMap(s => s.sessions)].map(s => [json([s.sourceId, s.family, s.originalRecordKey]), s])).values());
            for (const session of known) {
                const sessionKey = digest(json({ authorityId, profileId: set.profileId, accountId: set.accountId, sessionIdentity: session.sessionId }));
                sessions.set(sessionKey, Object.freeze({ sessionKey, producerKey: 'installed-controller-metadata' }));
            }
            if (!facts.mapper.complete || !known.length)
                throw Error('metadata_prepare_population');
            const intentId = randomUUID(), captureKey = digest(json({ authorityId, principal: capture.review.principal, sourceSet: set, manifestHash: capture.manifestHash, closure: facts })), material = { version: 1, state: 'prepared-archive', normalEligible: false, intentId, authorityId, poolId: db.prepare('SELECT pool_id FROM shared_capacity_identity WHERE id=1 AND authority_id=?').get(authorityId).pool_id, packageHash: lifetime.manifest.packageHash, serviceEpoch: lifetime.serviceEpoch, capture, closure: facts, knownSessionManifest: known, unknownFeeState: 'pending-unknown', unknownFees: facts.unresolved };
            const fileBytes = countBoundedProfileCaptureJson(material, LIMIT), databaseCopyBytes = fileBytes + 2 * 65536 + (sessions.size * 3 + 3) * 4096 + 16384;
            if (!Number.isSafeInteger(databaseCopyBytes) || fileBytes + databaseCopyBytes > VERIFICATION_BUDGET.controlDatabaseBytes)
                throw Error('metadata_prepare_budget');
            const feeFacts = Object.freeze([{ role: 'archive-file', partition: 'control', bytes: Math.ceil(fileBytes / BLOCK) * BLOCK }, { role: 'archive-db-copy', partition: 'control', bytes: Math.ceil(databaseCopyBytes / BLOCK) * BLOCK }, { role: 'archive-db-copy', partition: 'rollback', bytes: Math.ceil(databaseCopyBytes / BLOCK) * BLOCK }].map(f => Object.freeze(f)));
            const make = (identity) => { const handle = Object.freeze({}); bindings.set(handle, { group, identity }); return handle; }, handles = [make(Object.freeze({ sessionKey: digest(json({ authorityId, component: 'metadata-target-preparation' })), producerKey: 'installed-controller-metadata' })), ...[...sessions.values()].sort((a, b) => a.sessionKey.localeCompare(b.sessionKey)).map(make)], bound = ledger.bindOwners(handles), physical = bound[0], beneficiaries = bound.slice(1);
            const allocations = feeFacts.map(f => { const binding = { authorityId, intentId, role: f.role, partition: f.partition, bytes: f.bytes, captureKey }, hash = digest(json(binding)); return { owner: physical, beneficiaries, proposal: { operationId: 'metadata-archive-' + hash, resourceId: 'metadata-archive-' + hash, generation: 1, partition: f.partition, bytes: f.bytes, bindingHash: hash } }; });
            const initialized = metadata.initializeController();
            if (initialized.state !== 'confirmed' || initialized.writerGeneration !== lifetime.serviceEpoch || db.pragma('journal_mode', { simple: true }) !== 'delete' || db.pragma('synchronous', { simple: true }) !== 2)
                throw Error('metadata_prepare_headroom');
            assertVerificationDatabaseBudget(db, { additionalBytes: databaseCopyBytes });
            exactSchema(db);
            if (db.prepare('SELECT 1 FROM metadata_prepare_archive_intents WHERE capture_key=?').get(captureKey))
                throw Error('metadata_prepare_previous_pending');
            buffer = encodeBoundedProfileCaptureJson(material, LIMIT);
            const record = json({ ...material, fees: feeFacts, fileBytes, databaseCopyBytes, fileHash: digest(buffer) }), command = Object.freeze({}), f = { database: db, ledger, entries: allocations, current() { current(); signal.throwIfAborted(); groupCurrent(group); }, record, intentId, captureKey };
            commands.set(command, f);
            try {
                ledger.reserveMetadataCommand(command);
            }
            finally {
                commands.delete(command);
            }
            if (!f.result)
                throw Error('metadata_prepare_command_result');
            charged = true;
            e = { group, rowid: f.result, record, diagnostics: Object.freeze({ state: 'prepared-archive', normalEligible: false, intentId, knownFeeState: 'reserved', unknownFeeState: 'pending-unknown', originalUnresolved: facts.unresolved, fileBytes, databaseCopyBytes, fees: feeFacts }), path: join(lifetime.state, 'metadata-prepare-' + intentId + '.bin'), fileHash: digest(buffer), closed: false };
            owned.add(e);
            const directoryFD = directory();
            current();
            signal.throwIfAborted();
            e.fd = openSync(e.path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
            const physicalFile = inode(e.fd);
            e.identity = physicalFile.identity;
            if (!physicalFile.stat.isFile() || physicalFile.stat.nlink !== 1n || physicalFile.stat.uid !== BigInt(lifetime.manifest.serviceUid))
                throw Error('metadata_prepare_file');
            directory();
            const beforeWrite = lstatSync(e.path, { bigint: true });
            if (beforeWrite.isSymbolicLink() || !beforeWrite.isFile() || beforeWrite.dev !== physicalFile.stat.dev || beforeWrite.ino !== physicalFile.stat.ino || beforeWrite.nlink !== 1n)
                throw Error('metadata_prepare_file_changed');
            for (let offset = 0; offset < buffer.length;) {
                const written = writeSync(e.fd, buffer, offset, buffer.length - offset, offset);
                if (written < 1)
                    throw Error('metadata_prepare_partial');
                offset += written;
            }
            fsyncSync(e.fd);
            fsyncSync(directoryFD);
            checkEntry(e);
            const verify = Buffer.allocUnsafe(Math.min(65536, buffer.length)), hash = createHash('sha256');
            try {
                for (let offset = 0; offset < buffer.length;) {
                    const n = readSync(e.fd, verify, 0, Math.min(verify.length, buffer.length - offset), offset);
                    if (n < 1)
                        throw Error('metadata_prepare_partial');
                    hash.update(verify.subarray(0, n));
                    offset += n;
                }
                if (Number(fstatSync(e.fd).size) !== buffer.length || hash.digest('hex') !== digest(buffer))
                    throw Error('metadata_prepare_hash');
            }
            finally {
                verify.fill(0);
            }
            await checkInstalledMetadataClosure(lifetime, closure);
            current();
            signal.throwIfAborted();
            checkEntry(e);
            const entry = Object.freeze({});
            entries.set(entry, { factory, entry: e });
            return entry;
        }
        catch (error) {
            if (!charged)
                admitted.delete(closure);
            if (e)
                try {
                    closeActual(e);
                }
                catch (cleanupError) {
                    failedFactories.add(factory);
                    throw new AggregateError([error, cleanupError], 'metadata_prepare_cleanup_unknown', { cause: error });
                }
            throw error;
        }
        finally {
            buffer?.fill(0);
        }
    }
    const schemaSnapshot = () => json(db.prepare('SELECT type,name,tbl_name,sql FROM main.sqlite_master ORDER BY type,name').all());
    const factory = Object.freeze({ initialize() {
            if (arguments.length || initialization !== 'new')
                throw Error('metadata_prepare_initialization');
            current();
            if (db.inTransaction)
                throw Error('metadata_prepare_outer_transaction');
            const before = schemaSnapshot();
            try {
                const existing = db.prepare("SELECT name FROM main.sqlite_master WHERE name IN ('metadata_prepare_archive_intents','metadata_prepare_archive_slots')").all();
                if (existing.length !== 0 && existing.length !== 2)
                    throw Error('metadata_prepare_schema');
                if (existing.length)
                    exactSchema(db);
                metadata = createInstalledMetadataCapacity({ lifetime, sharedCapacity: shared });
                const initialized = metadata.initializeController();
                if (initialized.state !== 'confirmed' || initialized.writerGeneration !== lifetime.serviceEpoch || db.pragma('journal_mode', { simple: true }) !== 'delete' || db.pragma('synchronous', { simple: true }) !== 2)
                    throw Error('metadata_prepare_headroom');
                if (!existing.length)
                    runVerificationTransaction(db, () => { assertVerificationDatabaseBudget(db, { additionalBytes: 2 * 65536 + 16384 }); for (const sql of schema)
                        db.exec(sql); exactSchema(db); current(); });
                current();
                exactSchema(db);
                initialization = 'ready';
            }
            catch (error) {
                initializationError = error;
                initialization = 'failed';
                try {
                    current();
                    if (db.inTransaction || schemaSnapshot() !== before)
                        throw Error('metadata_prepare_schema_restore_unknown');
                    if (isInstalledMetadataMappingNotReady(error, db, authorityId) || isVerificationHeadroomNotReady(error, db)) {
                        initializationFees = ledger.usage();
                        initialization = 'disabled';
                        return;
                    }
                }
                catch (verificationError) {
                    throw new AggregateError([error, verificationError], 'metadata_prepare_initialization_unknown', { cause: error });
                }
                throw error;
            }
        }, readInitializationStatus() { current(); return Object.freeze({ state: initialization, normalEligible: false, error: initializationError, chargedUsage: initializationFees }); }, prepare(owner, token, closure, signal) { if (arguments.length !== 4)
            return Promise.reject(Error('metadata_prepare_arguments')); if (pending || closing)
            return Promise.reject(Error('metadata_prepare_pending')); const work = Promise.resolve().then(() => prepare(owner, token, closure, signal)); pending = work; void work.then(() => { if (pending === work)
            pending = undefined; }, () => { if (pending === work)
            pending = undefined; }); return work; },
        readPrepared(entry) { if (arguments.length !== 1)
            throw Error('metadata_prepare_arguments'); const f = entries.get(entry); if (!f || f.factory !== factory)
            throw Error('metadata_prepare_entry_brand'); checkEntry(f.entry); return f.entry.diagnostics; },
        closeEntry(entry) { if (arguments.length !== 1)
            throw Error('metadata_prepare_arguments'); const f = entries.get(entry); if (!f || f.factory !== factory)
            throw Error('metadata_prepare_entry_brand'); closeActual(f.entry); },
        close() { if (closePromise)
            return closePromise; closing = true; const work = (async () => { await pending?.catch(() => { }); const errors = []; for (const e of owned)
            try {
                closeActual(e);
            }
            catch (error) {
                errors.push(error);
            } if (errors.length)
            throw new AggregateError(errors, 'metadata_prepare_close_unknown'); if (dirFD !== undefined) {
            const expected = JSON.parse(dirIdentity), actual = fstatSync(dirFD, { bigint: true });
            if (String(actual.dev) !== expected.device || String(actual.ino) !== expected.inode || !actual.isDirectory())
                throw Error('metadata_prepare_close_identity');
            closeSync(dirFD);
            dirFD = undefined;
        } metadata?.close(); })(); closePromise = work; void work.then(() => failedFactories.delete(factory), () => { failedFactories.add(factory); if (closePromise === work)
            closePromise = undefined; }); return work; },
    });
    return factory;
}
