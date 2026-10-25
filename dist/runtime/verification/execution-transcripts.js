import { createExecutionTranscriptCapacityBinding } from './shared-blob-capacity.js';
import { consumeBlobCommandContext } from './blob-budget.js';
import { createHash, randomUUID } from 'node:crypto';
import { constants, mkdirSync, lstatSync, realpathSync, openSync, closeSync, writeFileSync, readFileSync, fsyncSync, fstatSync, readdirSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { runVerificationTransaction, assertVerificationDatabaseBudget } from './storage-budget.js';
import { assertVerificationBlobBudgetDatabase } from './blob-budget.js';
import { assertDockerRunnerDatabase } from '../isolated-execution/docker-runner.js';
const transcriptDatabases = new WeakMap();
export function assertExecutionTranscriptStoreDatabase(store, database) { const known = transcriptDatabases.get(store); if (!known || known.database !== database)
    throw Error('transcript_database_identity'); known.current(); }
export function assertExecutionTranscriptDeleted(store, database, proof, allocation) { const known = transcriptDatabases.get(store); if (!known || known.database !== database)
    throw Error('transcript_database_identity'); known.current(); const fact = known.deleted.get(proof), row = database.prepare('SELECT state FROM verification_execution_transcripts WHERE resource_id=?').get(allocation.resourceId); if (!fact || json(fact) !== json(allocation) || !/^[a-f0-9-]{36}$/.test(allocation.resourceId) || row?.state !== 'deleted' || existsSync(join(known.root, allocation.resourceId)))
    throw Error('transcript_deletion'); }
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const frozen = (value) => { if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
} return value; };
const snapshot = (value) => frozen(JSON.parse(json(value)));
function syncResult(value) { if (value !== undefined) {
    void Promise.resolve(value).catch(() => { });
    throw Error('transcript_sync_authority');
} }
const transcriptPrepareCommands = new WeakMap();
export function inspectTranscriptPrepareCommand(command, budget, database) {
    const facts = transcriptPrepareCommands.get(command);
    if (!facts)
        return undefined;
    if (facts.database !== database || facts.budget !== budget)
        throw Error('capacity_command_owner');
    return Object.freeze({ allocations: Object.freeze([facts.allocation]), capacityBinding: facts.capacityBinding });
}
export function executeTranscriptPrepareCommand(command, context) {
    const facts = transcriptPrepareCommands.get(command);
    if (!facts)
        return false;
    const { database: db, budget, allocation, manifest: m } = facts, tickets = consumeBlobCommandContext(context, budget, db, command);
    if (tickets.length !== 1 || !tickets[0].created)
        throw Error('transcript_database');
    assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(json(m)) + 8192 });
    db.prepare("INSERT INTO verification_execution_transcripts VALUES(?,?,?,?,?,NULL,'prepared')").run(allocation.resourceId, m.expected.executionIdentity, m.ownerKey, json(m), json(allocation));
    return true;
}
const identity = (path) => { const s = lstatSync(path); if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) !== 0)
    throw Error('transcript_directory'); return { dev: s.dev, ino: s.ino, uid: s.uid }; };
/** Immutable original single-execution bytes. This is not a whole-task archive
 * and does not turn component fixture ports into installed OS authority. */
export function createExecutionTranscriptStore(options) {
    const { database: db, budget, assertCurrent } = options, readOwner = options.execution.readOwnerKey.bind(options.execution), readExecution = options.execution.readExecution.bind(options.execution), readOutput = options.execution.readCapturedOutput.bind(options.execution), physical = options.quiescence.assertQuiescent.bind(options.quiescence), readAccess = options.access.assertRead.bind(options.access), deleteAccess = options.access.assertDelete.bind(options.access);
    assertDockerRunnerDatabase(options.execution, db);
    assertVerificationBlobBudgetDatabase(budget, db);
    budget.assertExternalOperationBoundary();
    mkdirSync(options.root, { recursive: true, mode: 0o700 });
    if (lstatSync(options.root).isSymbolicLink())
        throw Error('transcript_root');
    const root = realpathSync(options.root), rootIdentity = identity(root);
    let closed = false;
    db.exec("CREATE TABLE IF NOT EXISTS verification_transcript_root(id INTEGER PRIMARY KEY CHECK(id=1),identity_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS verification_execution_transcripts(resource_id TEXT PRIMARY KEY,execution_id TEXT UNIQUE NOT NULL,owner_key TEXT NOT NULL,manifest_json TEXT NOT NULL,allocation_json TEXT NOT NULL,directory_json TEXT,state TEXT NOT NULL)");
    runVerificationTransaction(db, () => { syncResult(assertCurrent()); const old = db.prepare('SELECT identity_json FROM verification_transcript_root WHERE id=1').get(); if (old && old.identity_json !== json(rootIdentity))
        throw Error('transcript_root_changed'); if (!old)
        db.prepare('INSERT INTO verification_transcript_root VALUES(1,?)').run(json(rootIdentity)); });
    syncDirectoryTreeStrict(root);
    const deleted = new WeakMap();
    function current() { if (closed)
        throw Error('transcript_closed'); syncResult(assertCurrent()); if (json(identity(root)) !== json(rootIdentity))
        throw Error('transcript_root_changed'); }
    function row(id) { current(); if (!/^[a-f0-9-]{36}$/.test(id))
        throw Error('transcript_identity'); const r = db.prepare('SELECT * FROM verification_execution_transcripts WHERE resource_id=?').get(id); if (!r)
        throw Error('transcript_missing'); return r; }
    function manifest(r) { const m = snapshot(JSON.parse(r.manifest_json)); if (m.ownerKey !== r.owner_key || m.expected.executionIdentity !== r.execution_id || m.scope !== 'isolated-execution')
        throw Error('transcript_manifest'); return m; }
    function directory(r) { const path = join(root, r.resource_id); if (!r.directory_json || json(identity(path)) !== r.directory_json)
        throw Error('transcript_directory_changed'); return path; }
    function bytes(r, name) { const m = manifest(r), path = join(directory(r), name), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try {
        const s = fstatSync(fd);
        if (!s.isFile() || s.nlink !== 1 || s.uid !== rootIdentity.uid || s.size !== m[name].size)
            throw Error('transcript_file_changed');
        const b = readFileSync(fd);
        if (b.length !== m[name].size || hash(b) !== m[name].sha256)
            throw Error('transcript_file_changed');
        return b;
    }
    finally {
        closeSync(fd);
    } }
    const deletionAuthority = Object.freeze({ assertDeleted(proof, allocation) { current(); const known = deleted.get(proof); if (!known || json(known) !== json(allocation) || row(allocation.resourceId).state !== 'deleted' || existsSync(join(root, allocation.resourceId)))
            throw Error('transcript_deletion'); } });
    const store = Object.freeze({ deletionAuthority,
        describeArchive(resourceId) { const r = row(resourceId); return snapshot({ resourceId: r.resource_id, state: r.state, manifest: manifest(r) }); },
        record(input) {
            current();
            budget.assertExternalOperationBoundary();
            const { output, receipt } = input, expected = snapshot(input.expected), ownerKey = input.ownerKey;
            if (readOwner(expected) !== ownerKey)
                throw Error('transcript_owner');
            syncResult(physical(receipt, expected));
            const execution = readExecution(expected);
            if (execution.state !== 'terminal' || execution.cancelledBeforeStart || !Number.isSafeInteger(execution.exitCode) || json(execution.expected) !== json(expected))
                throw Error('transcript_execution');
            const observed = readOutput(output, { expected });
            if (!Buffer.isBuffer(observed.stdout) || !Buffer.isBuffer(observed.stderr) || observed.stdout.length + observed.stderr.length > 4 * 1024 ** 2 || typeof observed.complete !== 'boolean' || typeof observed.truncated !== 'boolean' || observed.complete && observed.truncated)
                throw Error('transcript_output_limit');
            const stdout = Buffer.from(observed.stdout), stderr = Buffer.from(observed.stderr);
            const m = snapshot({ version: 1, scope: 'isolated-execution', ownerKey, expected, engine: { id: execution.proposal.engineBindingId, epoch: execution.proposal.engineEpoch, imageId: execution.proposal.imageId }, exitCode: execution.exitCode, complete: observed.complete, truncated: observed.truncated, ...(observed.reason ? { reason: observed.reason } : {}), stdout: { size: stdout.length, sha256: hash(stdout) }, stderr: { size: stderr.length, sha256: hash(stderr) } });
            let r = db.prepare('SELECT * FROM verification_execution_transcripts WHERE execution_id=?').get(expected.executionIdentity);
            if (r && (r.owner_key !== ownerKey || r.manifest_json !== json(m) || r.state === 'deleted'))
                throw Error('transcript_original_conflict');
            if (r?.state === 'ready') {
                bytes(r, 'stdout');
                bytes(r, 'stderr');
                return Object.freeze({ resourceId: r.resource_id, manifest: m });
            }
            if (!r) {
                const resourceId = randomUUID(), allocation = { ownerKey, resourceId, kind: 'host-export', scopeDigest: expected.scopeDigest, bytes: 2 * (Math.max(4096, Math.ceil(stdout.length / 4096) * 4096) + Math.max(4096, Math.ceil(stderr.length / 4096) * 4096)) };
                const command = Object.freeze({});
                transcriptPrepareCommands.set(command, { database: db, budget, allocation: snapshot(allocation), manifest: m, capacityBinding: budget.usesSharedCapacity ? createExecutionTranscriptCapacityBinding({ database: db, raw: options.execution, expected, allocation }) : undefined });
                try {
                    budget.reserveCommand(command);
                }
                finally {
                    transcriptPrepareCommands.delete(command);
                }
                r = row(resourceId);
            }
            const live = () => { current(); budget.assertExternalOperationBoundary(); syncResult(physical(receipt, expected)); if (readOwner(expected) !== ownerKey)
                throw Error('transcript_owner'); if (budget.getState(JSON.parse(r.allocation_json)) !== 'reserved')
                throw Error('transcript_reservation'); };
            live();
            if (!r.directory_json) {
                const path = join(root, r.resource_id);
                if (existsSync(path))
                    throw Error('transcript_unknown_directory');
                mkdirSync(path, { mode: 0o700 });
                const id = json(identity(path));
                runVerificationTransaction(db, () => { db.prepare('UPDATE verification_execution_transcripts SET directory_json=? WHERE resource_id=? AND directory_json IS NULL').run(id, r.resource_id); });
                r = row(r.resource_id);
            }
            for (const [name, body] of [['stdout', stdout], ['stderr', stderr]]) {
                live();
                const path = join(directory(r), name);
                if (existsSync(path)) {
                    if (!bytes(r, name).equals(body))
                        throw Error('transcript_original_conflict');
                    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
                    try {
                        fsyncSync(fd);
                    }
                    finally {
                        closeSync(fd);
                    }
                }
                else {
                    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
                    try {
                        writeFileSync(fd, body);
                        fsyncSync(fd);
                    }
                    finally {
                        closeSync(fd);
                    }
                }
            }
            syncDirectoryTreeStrict(directory(r));
            live();
            runVerificationTransaction(db, () => { db.prepare("UPDATE verification_execution_transcripts SET state='ready' WHERE resource_id=? AND state='prepared'").run(r.resource_id); });
            return Object.freeze({ resourceId: r.resource_id, manifest: m });
        },
        read(resourceId, authorization) { const r = row(resourceId); if (r.state !== 'ready')
            throw Error('transcript_unavailable'); const m = manifest(r); syncResult(readAccess(m, authorization)); const stdout = bytes(r, 'stdout'), stderr = bytes(r, 'stderr'); syncResult(readAccess(m, authorization)); current(); return Object.freeze({ manifest: m, stdout, stderr }); },
        delete(resourceId, context) { current(); budget.assertExternalOperationBoundary(); if (context.requestSource !== 'user')
            throw Error('transcript_delete_source'); const r = row(resourceId), m = manifest(r); syncResult(deleteAccess(m, context.authorization)); budget.assertExternalOperationBoundary(); const path = join(root, resourceId); if (existsSync(path)) {
            if (r.directory_json === null && r.state === 'prepared') {
                const actual = identity(path);
                if (actual.uid !== rootIdentity.uid || readdirSync(path).length !== 0)
                    throw Error('transcript_unknown_directory'); /* Sole pre-write gap: explicit authorized deletion may remove the empty durable UUID directory, never adopt it as readable output. */
            }
            else
                directory(r);
            const names = readdirSync(path);
            for (const name of names) {
                if (!['stdout', 'stderr'].includes(name))
                    throw Error('transcript_unknown_file');
                const s = lstatSync(join(path, name));
                if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== rootIdentity.uid)
                    throw Error('transcript_unknown_file');
            }
            syncResult(deleteAccess(m, context.authorization));
            for (const name of names) {
                syncResult(deleteAccess(m, context.authorization));
                unlinkSync(join(path, name));
            }
            syncResult(deleteAccess(m, context.authorization));
            rmdirSync(path);
        } syncDirectoryTreeStrict(root); current(); syncResult(deleteAccess(m, context.authorization)); runVerificationTransaction(db, () => { db.prepare("UPDATE verification_execution_transcripts SET state='deleted' WHERE resource_id=?").run(resourceId); }); const allocation = JSON.parse(r.allocation_json); if (budget.getState(allocation) !== 'released') {
            const token = budget.reserve(allocation).token, proof = Object.freeze({});
            deleted.set(proof, allocation);
            budget.release(token, proof);
        } },
        reconcileDeletedBudget(input) {
            current();
            budget.assertExternalOperationBoundary();
            if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 64 || input.after !== undefined && !/^[a-f0-9-]{36}$/.test(input.after))
                throw Error('transcript_recovery_page');
            const rows = db.prepare("SELECT * FROM verification_execution_transcripts WHERE state='deleted' AND resource_id>? ORDER BY resource_id LIMIT ?").all(input.after ?? '', input.limit);
            for (const r of rows) {
                current();
                const m = manifest(r), allocation = JSON.parse(r.allocation_json);
                const expectedBytes = 2 * (Math.max(4096, Math.ceil(m.stdout.size / 4096) * 4096) + Math.max(4096, Math.ceil(m.stderr.size / 4096) * 4096));
                if (allocation.resourceId !== r.resource_id || allocation.ownerKey !== r.owner_key || allocation.kind !== 'host-export' || allocation.scopeDigest !== m.expected.scopeDigest || allocation.bytes !== expectedBytes)
                    throw Error('transcript_recovery_allocation');
                const state = budget.getState(allocation);
                if (state === 'released')
                    continue;
                if (state !== 'reserved')
                    throw Error('transcript_recovery_reservation');
                try {
                    lstatSync(join(root, r.resource_id));
                    throw Error('transcript_recovery_present');
                }
                catch (e) {
                    if (e.code !== 'ENOENT')
                        throw e;
                }
                syncDirectoryTreeStrict(root);
                current();
                if (json(row(r.resource_id)) !== json(r))
                    throw Error('transcript_recovery_changed');
                const ticket = budget.reserve(allocation);
                if (ticket.created)
                    throw Error('transcript_recovery_reservation');
                const proof = Object.freeze({});
                deleted.set(proof, allocation);
                budget.release(ticket.token, proof);
            }
            return Object.freeze({ processed: rows.length, nextCursor: rows.length === input.limit ? rows.at(-1).resource_id : null });
        },
        close() { closed = true; }, });
    transcriptDatabases.set(store, { database: db, root, deleted, current });
    return store;
}
