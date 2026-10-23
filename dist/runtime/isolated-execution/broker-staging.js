import { createHash, randomUUID } from 'node:crypto';
import { consumeBlobCommandContext } from '../verification/blob-budget.js';
import { mkdirSync, lstatSync, realpathSync, openSync, closeSync, writeFileSync, fsyncSync, fstatSync, readFileSync, readdirSync, unlinkSync, rmdirSync, constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assertVerificationBlobBudgetDatabase } from '../verification/blob-budget.js';
import { canonicalVerificationJson } from '../verification/protocol.js';
import { assertVerificationDatabaseBudget, runVerificationTransaction } from '../verification/storage-budget.js';
import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
const stagingInstances = new WeakMap();
export function assertBrokerStagingDeleted(stager, database, proof, proposal) { const known = stagingInstances.get(stager); if (!known || known.database !== database)
    throw Error('broker_staging_database'); known.current(); const fact = known.deleted.get(proof); if (!fact || digest(fact) !== digest(proposal))
    throw Error('broker_staging_deletion'); }
const stagingPrepareCommands = new WeakMap();
export function inspectStagingPrepareCommand(command, budget, database) { const facts = stagingPrepareCommands.get(command); if (!facts)
    return undefined; if (facts.database !== database || facts.budget !== budget)
    throw Error('capacity_command_owner'); return Object.freeze({ allocations: Object.freeze([facts.allocation]), capacityBinding: facts.capacityBinding }); }
export function executeStagingPrepareCommand(command, context) { const facts = stagingPrepareCommands.get(command); if (!facts)
    return false; const { database: db, budget, allocation, recordJson } = facts; const tickets = consumeBlobCommandContext(context, budget, db, command); if (tickets.length !== 1 || !tickets[0].created)
    throw Error('broker_staging_database'); assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(recordJson) + 4096 }); db.prepare("INSERT INTO broker_staging_intents VALUES(?,?,?,'prepared')").run(allocation.resourceId, allocation.scopeDigest, recordJson); return true; }
const capacityPlans = new WeakMap();
export function readBrokerStagingCapacitySource(plan, database) { const known = capacityPlans.get(plan); if (!known || known.database !== database)
    throw Error('broker_staging_capacity_plan'); return known.read(); }
const digest = (value) => createHash('sha256').update(canonicalVerificationJson(value)).digest('hex');
const bytesHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => JSON.parse(canonicalVerificationJson(value));
function frozen(value) { if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
} return value; }
function synchronous(value) { if (value !== undefined) {
    void Promise.resolve(value).catch(() => { });
    throw Error('broker_staging_sync');
} }
/** Dedicated service does not open project files. Only its captured private
 * broker access reads as the original user; opaque grant facts define all scope. */
export function createBrokerInputStager(options) {
    const { database: db, budget, assertCurrent, assertCleanup } = options, getFacts = options.access.getFacts.bind(options.access), readPage = options.access.readPage.bind(options.access);
    assertVerificationBlobBudgetDatabase(budget, db);
    budget.assertExternalOperationBoundary();
    mkdirSync(options.root, { recursive: true, mode: 0o700 });
    if (lstatSync(options.root).isSymbolicLink())
        throw Error('broker_staging_root');
    const root = realpathSync(options.root), identity = lstatSync(root);
    const deleted = new WeakMap(), unpublishedCleanup = new WeakMap();
    let deleting = false;
    const handoffs = new WeakMap();
    const plans = new WeakMap();
    db.exec('CREATE TABLE IF NOT EXISTS broker_staging_intents(resource_id TEXT PRIMARY KEY,scope_digest TEXT UNIQUE NOT NULL,record_json TEXT NOT NULL,state TEXT NOT NULL)');
    function current() { synchronous(assertCurrent()); const s = lstatSync(root); if (!s.isDirectory() || s.isSymbolicLink() || s.dev !== identity.dev || s.ino !== identity.ino || s.uid !== identity.uid || (s.mode & 0o077) !== 0)
        throw Error('broker_staging_root'); }
    function facts(grant) { current(); const value = getFacts(grant); if (value && typeof value.then === 'function') {
        void Promise.resolve(value).catch(() => { });
        throw Error('broker_staging_sync');
    } return frozen(clone(value)); }
    function known(plan, expectedState = 'published') { current(); const record = plans.get(plan); if (!record)
        throw Error('broker_staging_plan'); if (digest(facts(record.grant)) !== record.factsHash)
        throw Error('broker_staging_changed'); if (db.prepare('SELECT state FROM broker_staging_intents WHERE resource_id=?').get(record.allocation.resourceId)?.state !== expectedState)
        throw Error('broker_staging_state'); if (budget.getState(record.allocation) !== 'reserved')
        throw Error('broker_staging_capacity'); return record; }
    function deleteResource(resourceId, unpublishedProof) {
        // The intent must commit before irreversible I/O; an enclosing transaction may roll back.
        if (db.inTransaction)
            throw Error('broker_staging_outer_transaction');
        if (deleting)
            throw Error('broker_staging_reentrant');
        deleting = true;
        try {
            current();
            if (typeof resourceId !== 'string' || !/^[a-f0-9-]{36}$/.test(resourceId))
                throw Error('broker_staging_resource');
            if (unpublishedProof) {
                if (unpublishedCleanup.get(unpublishedProof) !== resourceId)
                    throw Error('broker_staging_unpublished');
            }
            else
                synchronous(assertCleanup(resourceId));
            const row = db.prepare('SELECT record_json,state FROM broker_staging_intents WHERE resource_id=?').get(resourceId);
            if (!row)
                throw Error('broker_staging_resource');
            if (unpublishedProof && !['prepared', 'ready', 'deleting', 'deleted'].includes(row.state))
                throw Error('broker_staging_already_published');
            const record = JSON.parse(row.record_json);
            if (record.directory !== resourceId || record.allocation.resourceId !== resourceId)
                throw Error('broker_staging_resource');
            runVerificationTransaction(db, () => { db.prepare("UPDATE broker_staging_intents SET state='deleting' WHERE resource_id=?").run(resourceId); });
            const directory = join(root, resourceId);
            let stat;
            try {
                stat = lstatSync(directory);
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            if (stat) {
                if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== identity.uid || (stat.mode & 0o077) !== 0)
                    throw Error('broker_staging_root');
                const names = readdirSync(directory);
                for (const name of names) {
                    if (!/^(0|[1-9][0-9]*)$/.test(name) || Number(name) >= record.manifest.files.length)
                        throw Error('broker_staging_unknown_file');
                    const file = lstatSync(join(directory, name));
                    if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.uid !== identity.uid)
                        throw Error('broker_staging_unknown_file');
                }
                for (const name of names)
                    unlinkSync(join(directory, name));
                rmdirSync(directory);
            }
            // Repeat the actual parent barrier even if a previous deletion lost its ack.
            syncDirectoryTreeStrict(root);
            current();
            runVerificationTransaction(db, () => { db.prepare("UPDATE broker_staging_intents SET state='deleted' WHERE resource_id=?").run(resourceId); });
            if (budget.getState(record.allocation) !== 'released') {
                const token = budget.reserve(record.allocation).token, proof = Object.freeze({});
                deleted.set(proof, record.allocation);
                budget.release(token, proof);
            }
        }
        finally {
            deleting = false;
        }
    }
    const api = Object.freeze({
        deletionAuthority: Object.freeze({ assertDeleted(proof, proposal) { current(); const value = deleted.get(proof); if (!value || digest(value) !== digest(proposal))
                throw Error('broker_staging_deletion'); } }),
        deleteResource(resourceId) { deleteResource(resourceId); },
        acceptPlan(plan) {
            if (db.inTransaction)
                throw Error('broker_staging_outer_transaction');
            const handoff = handoffs.get(plan);
            if (!handoff)
                throw Error('broker_staging_handoff');
            known(plan, 'ready');
            runVerificationTransaction(db, () => { known(plan, 'ready'); const changed = db.prepare("UPDATE broker_staging_intents SET state='published' WHERE resource_id=? AND state='ready'").run(handoff.resourceId); if (changed.changes !== 1)
                throw Error('broker_staging_handoff'); });
            handoffs.delete(plan);
            unpublishedCleanup.delete(handoff.cleanupProof);
        },
        discardUnpublishedPlan(plan) { const handoff = handoffs.get(plan); if (!handoff)
            throw Error('broker_staging_handoff'); deleteResource(handoff.resourceId, handoff.cleanupProof); handoffs.delete(plan); unpublishedCleanup.delete(handoff.cleanupProof); plans.delete(plan); },
        async prepareValidationInput(input) {
            // The intent must commit before irreversible I/O; an enclosing transaction may roll back.
            if (db.inTransaction)
                throw Error('broker_staging_outer_transaction');
            const { grant, ownerKey, signal, capacityBinding } = input, approved = facts(grant), factsHash = digest(approved), review = approved.review;
            signal.throwIfAborted();
            if (!review.materials.length || review.materials.length > 1024 || approved.executableFiles.length !== review.materials.length)
                throw Error('broker_staging_scope');
            const total = review.materials.reduce((n, f) => { if (!Number.isSafeInteger(f.size) || f.size < 0 || f.size > 16 * 1024 ** 2 || f.size > f.byteLimit || !isAbsolute(f.path) || resolve(f.path) !== f.path || !/^[a-f0-9]{64}$/.test(f.sha256))
                throw Error('broker_staging_scope'); return n + f.size; }, 0);
            let workspace = dirname(review.materials[0].path);
            for (const file of review.materials) {
                while (true) {
                    const rel = relative(workspace, file.path);
                    if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
                        break;
                    const next = dirname(workspace);
                    if (next === workspace)
                        throw Error('broker_staging_scope');
                    workspace = next;
                }
            }
            const names = new Set();
            const files = review.materials.map((file, index) => { const path = relative(workspace, file.path).split(sep).join('/'), mode = approved.executableFiles[index]; if (!path || path.split('/').length > 64 || Buffer.byteLength(path) > 4096 || path.split('/').some(p => !p || p === '.' || p === '..' || /[\x00-\x1f\x7f:\\]/.test(p)) || names.has(path.toLowerCase()) || mode.path !== file.path || typeof mode.executable !== 'boolean')
                throw Error('broker_staging_scope'); names.add(path.toLowerCase()); return Object.freeze({ path, contentHash: file.sha256, size: file.size, executable: mode.executable }); });
            for (const name of names)
                for (const other of names)
                    if (other.startsWith(name + '/'))
                        throw Error('broker_staging_scope');
            const manifest = frozen({ files, scopeDigest: review.scopeDigest, command: clone(review.exactCommand), invocation: clone(review.invocation) }), id = randomUUID(), directory = join(root, id), allocation = { ownerKey, resourceId: id, kind: 'host-staging', bytes: total, scopeDigest: review.scopeDigest, engineBinding: clone(review.engineBinding) };
            const recordJson = canonicalVerificationJson({ directory: id, manifest, allocation, factsHash });
            const command = Object.freeze({});
            stagingPrepareCommands.set(command, { database: db, budget, allocation: frozen(clone(allocation)), capacityBinding, recordJson });
            try {
                budget.reserveCommand(command);
            }
            finally {
                stagingPrepareCommands.delete(command);
            }
            const cleanupProof = Object.freeze({});
            unpublishedCleanup.set(cleanupProof, id);
            let transferred = false;
            try {
                mkdirSync(directory, { mode: 0o700 });
                const live = () => { signal.throwIfAborted(); if (db.prepare('SELECT state FROM broker_staging_intents WHERE resource_id=?').get(id)?.state !== 'prepared' || budget.getState(allocation) !== 'reserved')
                    throw Error('broker_staging_state'); if (digest(facts(grant)) !== factsHash)
                    throw Error('broker_staging_changed'); };
                for (let index = 0; index < files.length; index++) {
                    const file = files[index], original = review.materials[index], chunks = [];
                    let offset = 0;
                    do {
                        live();
                        const length = Math.min(512 * 1024, Math.max(1, file.size - offset)), page = await readPage(grant, { path: original.path, byteLimit: original.byteLimit, contentHash: file.contentHash, offset, length }, signal);
                        live();
                        if (!page || page.contentHash !== file.contentHash || page.totalBytes !== file.size || page.executable !== file.executable || page.offset !== offset || typeof page.bytes !== 'string' || page.bytes.length > 4 * Math.ceil(length / 3))
                            throw Error('broker_staging_page');
                        const bytes = Buffer.from(page.bytes, 'base64');
                        if (bytes.toString('base64') !== page.bytes || bytes.length !== Math.min(length, file.size - offset))
                            throw Error('broker_staging_page');
                        chunks.push(bytes);
                        offset += bytes.length;
                    } while (offset < file.size);
                    const body = Buffer.concat(chunks);
                    if (body.length !== file.size || bytesHash(body) !== file.contentHash)
                        throw Error('broker_staging_hash');
                    live();
                    const fd = openSync(join(directory, String(index)), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o400);
                    try {
                        writeFileSync(fd, body);
                        fsyncSync(fd);
                    }
                    finally {
                        closeSync(fd);
                    }
                }
                syncDirectoryTreeStrict(directory);
                live();
                runVerificationTransaction(db, () => { live(); const result = db.prepare("UPDATE broker_staging_intents SET state='ready' WHERE resource_id=? AND state='prepared'").run(id); if (result.changes !== 1)
                    throw Error('broker_staging_state'); });
                const plan = Object.freeze({});
                plans.set(plan, { grant, factsHash, directory, manifest, allocation });
                capacityPlans.set(plan, { database: db, read() { return known(plan).allocation; } });
                handoffs.set(plan, { cleanupProof, resourceId: id });
                transferred = true;
                return Object.freeze({ materializedInput: plan, command: manifest.command, scopeDigest: manifest.scopeDigest });
            }
            catch (error) {
                // No plan escaped this call, and all local writes have stopped. This is not
                // permission to delete a published plan after a lost client response.
                try {
                    deleteResource(id, cleanupProof);
                }
                catch (cleanupError) {
                    throw new AggregateError([error, cleanupError], 'broker_staging_failed_cleanup_unknown');
                }
                throw error;
            }
            finally {
                if (!transferred)
                    unpublishedCleanup.delete(cleanupProof);
            }
        },
        getManifest(plan) { return known(plan).manifest; },
        readFile(plan, path) {
            const record = known(plan), index = record.manifest.files.findIndex(f => f.path === path);
            if (index < 0)
                throw Error('broker_staging_file');
            const file = record.manifest.files[index], dir = lstatSync(record.directory);
            if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== identity.uid || (dir.mode & 0o077) !== 0)
                throw Error('broker_staging_root');
            const fd = openSync(join(record.directory, String(index)), constants.O_RDONLY | constants.O_NOFOLLOW);
            let body;
            try {
                const stat = fstatSync(fd);
                if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== identity.uid || stat.size !== file.size || (stat.mode & 0o777) !== 0o400)
                    throw Error('broker_staging_file');
                body = readFileSync(fd);
            }
            finally {
                closeSync(fd);
            }
            if (body.length !== file.size || bytesHash(body) !== file.contentHash)
                throw Error('broker_staging_hash');
            known(plan);
            return body;
        },
    });
    stagingInstances.set(api, { database: db, deleted, current });
    return api;
}
