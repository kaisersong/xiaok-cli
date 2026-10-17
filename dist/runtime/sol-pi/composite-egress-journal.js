import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
function reject() { throw Error('SOL_PI_COMPOSITE_EGRESS_JOURNAL_REJECTED'); }
function id(value) { if (typeof value !== 'string' || !value || value.length > 256 || /[\x00-\x1f\x7f]/.test(value))
    reject(); }
function digest(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    reject(); }
function exact(value, keys) { if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length)
    reject(); for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor))
        reject();
} }
function snapshot(input) {
    exact(input, ['attemptId', 'invocationId', 'bodySha256', 'destination', 'model', 'protocol', 'participants', 'reservationSha256']);
    const { attemptId, invocationId, bodySha256, destination, model, protocol, participants, reservationSha256 } = input;
    for (const value of [attemptId, invocationId, model, protocol])
        id(value);
    digest(bodySha256);
    digest(reservationSha256);
    if (typeof destination !== 'string' || destination.length > 2048)
        reject();
    const url = new URL(destination);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
        reject();
    if (!Array.isArray(participants) || !participants.length || participants.length > 64)
        reject();
    const frozen = participants.map(participant => { exact(participant, ['authorityId', 'leaseId', 'evidenceSha256']); const { authorityId, leaseId, evidenceSha256 } = participant; id(authorityId); id(leaseId); digest(evidenceSha256); return { authorityId, leaseId, evidenceSha256 }; });
    if (new Set(frozen.map(p => p.authorityId)).size !== frozen.length)
        reject();
    frozen.sort((a, b) => Buffer.compare(Buffer.from(a.authorityId), Buffer.from(b.authorityId)));
    return { attemptId, invocationId, bodySha256, destination, model, protocol, participants: frozen, reservationSha256 };
}
/** Durable FACT journal only: this module neither authenticates participant evidence nor
 * grants permission to send/fence anything. The actual host coordinator must verify all
 * participant receipts and physical generation before writing a dispatch decision.
 * Reopening this database does not prove the previous TLS owner has stopped. */
export function createCompositeEgressJournal(options) {
    const { egressId, generation } = options;
    id(egressId);
    if (!Number.isSafeInteger(generation) || generation < 1)
        reject();
    mkdirSync(options.root, { recursive: true, mode: 0o700 });
    if (lstatSync(options.root).isSymbolicLink())
        reject();
    const root = realpathSync(options.root);
    if (process.platform !== 'win32' && (lstatSync(root).mode & 0o077) !== 0)
        reject();
    const rootIdentity = lstatSync(root);
    const sameInode = (path, expected, directory = false) => { const actual = lstatSync(path); if (actual.dev !== expected.dev || actual.ino !== expected.ino || actual.isSymbolicLink() || (directory ? !actual.isDirectory() : !actual.isFile() || actual.nlink !== 1))
        reject(); };
    function census() { let bytes = 0; for (const name of readdirSync(root)) {
        if (!['owner.sqlite', 'owner.sqlite-journal', 'attempts.sqlite', 'attempts.sqlite-journal'].includes(name))
            reject();
        const entry = lstatSync(join(root, name));
        if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 9 * 1024 * 1024)
            reject();
        bytes += entry.size;
    } if (bytes > 18 * 1024 * 1024)
        reject(); }
    census();
    const existing = existsSync(join(root, 'attempts.sqlite'));
    if (!existing && readdirSync(root).length)
        reject();
    let owner, db;
    let closed = false, quarantined = false;
    let ownerIdentity, databaseIdentity;
    try {
        owner = new Database(join(root, 'owner.sqlite'), { timeout: 0 });
        owner.exec('BEGIN EXCLUSIVE');
        census();
        db = new Database(join(root, 'attempts.sqlite'), { timeout: 0 });
        db.pragma('journal_mode = DELETE');
        db.pragma('synchronous = EXTRA');
        db.pragma('fullfsync = ON');
        const size = db.pragma('page_size', { simple: true });
        if (!Number.isSafeInteger(size) || size < 512)
            reject();
        const maximum = Math.floor(8 * 1024 * 1024 / size);
        if (db.pragma(`max_page_count = ${maximum}`, { simple: true }) !== maximum)
            reject();
        if (existing && db.pragma('user_version', { simple: true }) !== 1)
            reject();
        db.exec('CREATE TABLE IF NOT EXISTS identity(id INTEGER PRIMARY KEY CHECK(id=1),egress TEXT NOT NULL,generation INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,invocation TEXT NOT NULL UNIQUE,binding TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL)');
        const identity = db.prepare('SELECT egress,generation FROM identity WHERE id=1').get();
        if (existing && !identity)
            reject();
        if (identity) {
            if (identity.egress !== egressId || identity.generation !== generation)
                reject();
        }
        else
            db.prepare('INSERT INTO identity VALUES(1,?,?)').run(egressId, generation);
        if (!existing)
            db.pragma('user_version = 1');
        syncDirectoryTreeStrict(root);
        census();
        sameInode(root, rootIdentity, true);
        ownerIdentity = lstatSync(join(root, 'owner.sqlite'));
        databaseIdentity = lstatSync(join(root, 'attempts.sqlite'));
        sameInode(join(root, 'owner.sqlite'), ownerIdentity);
        sameInode(join(root, 'attempts.sqlite'), databaseIdentity);
    }
    catch (error) {
        try {
            db?.close();
        }
        finally {
            owner?.close();
        }
        throw error;
    }
    const database = db;
    function namespace() { sameInode(root, rootIdentity, true); sameInode(join(root, 'owner.sqlite'), ownerIdentity); sameInode(join(root, 'attempts.sqlite'), databaseIdentity); }
    function live() { if (closed || quarantined)
        reject(); try {
        namespace();
        census();
    }
    catch (error) {
        quarantined = true;
        throw error;
    } }
    function read(attemptId) { live(); id(attemptId); const row = database.prepare('SELECT payload,state,binding FROM attempts WHERE id=?').get(attemptId); if (!row)
        return undefined; const parsed = JSON.parse(row.payload); const valid = snapshot(parsed); if (valid.attemptId !== attemptId)
        reject(); if (createHash('sha256').update(JSON.stringify(valid)).digest('hex') !== row.binding || !['PREPARING', 'PREPARED', 'DISPATCH_COMMITTED', 'ABORTED_NO_DISPATCH', 'SUCCEEDED', 'FAILED_AFTER_DISPATCH', 'UNKNOWN'].includes(row.state))
        reject(); return { ...valid, egressId, generation, bindingSha256: row.binding, state: row.state }; }
    function write(operation) { live(); try {
        database.transaction(operation).immediate();
        syncDirectoryTreeStrict(root);
        namespace();
        census();
    }
    catch (error) {
        quarantined = true;
        throw error;
    } }
    function transition(attemptId, allowed, state) { live(); const current = read(attemptId); if (!current || !allowed.includes(current.state))
        reject(); write(() => { const result = database.prepare('UPDATE attempts SET state=? WHERE id=? AND state=?').run(state, attemptId, current.state); if (result.changes !== 1)
        reject(); }); }
    return Object.freeze({
        prepare(input) {
            live();
            const frozen = snapshot(input), payload = JSON.stringify(frozen);
            if (Buffer.byteLength(payload) > 32768)
                reject();
            const binding = createHash('sha256').update(payload).digest('hex');
            const old = read(frozen.attemptId);
            if (old) {
                if (old.bindingSha256 !== binding)
                    reject();
                return old;
            }
            const count = database.prepare('SELECT COUNT(*) AS n FROM attempts').get().n;
            if (count >= 256)
                reject();
            if (database.prepare('SELECT id FROM attempts WHERE invocation=?').get(frozen.invocationId))
                reject();
            write(() => { database.prepare('INSERT INTO attempts(id,invocation,binding,payload,state) VALUES(?,?,?,?,?)').run(frozen.attemptId, frozen.invocationId, binding, payload, 'PREPARING'); });
            return read(frozen.attemptId);
        },
        query: read,
        markPrepared(attemptId) { transition(attemptId, ['PREPARING'], 'PREPARED'); },
        commitDispatch(attemptId) { transition(attemptId, ['PREPARED'], 'DISPATCH_COMMITTED'); },
        abortBeforeDispatch(attemptId) { transition(attemptId, ['PREPARING', 'PREPARED'], 'ABORTED_NO_DISPATCH'); },
        settle(attemptId, state) { if (!['SUCCEEDED', 'FAILED_AFTER_DISPATCH', 'UNKNOWN'].includes(state))
            reject(); transition(attemptId, ['DISPATCH_COMMITTED'], state); },
        close() { if (closed)
            return; closed = true; try {
            database.close();
        }
        finally {
            owner.close();
        } },
    });
}
