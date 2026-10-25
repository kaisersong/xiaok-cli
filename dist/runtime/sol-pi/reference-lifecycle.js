import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mergeProtectedObservationClosures } from '../../ai/runtime/protected-observation-closure.js';
export const REFERENCE_LIFECYCLE_RESERVED_BYTES = 34 * 1024 * 1024;
/** Main/CLI host only. Possession of this object is not exposed through tools or IPC.
 * begin is called only after the host admits an actual user deletion; completed
 * means the host's durable deletion journal committed, never mere file absence. */
export class ReferenceDeletionReceiptStore {
    db;
    constructor(profileRoot) {
        mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
        if (lstatSync(profileRoot).isSymbolicLink())
            throw new Error('unsafe_reference_lifecycle_root');
        const file = join(profileRoot, 'reference-deletions.sqlite');
        for (const candidate of [file, file + '-journal', file + '-wal', file + '-shm'])
            if (existsSync(candidate) && (!lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink() || lstatSync(candidate).size > 17 * 1024 * 1024))
                throw new Error('unsafe_reference_lifecycle_store');
        if (existsSync(file + '-wal') || existsSync(file + '-shm'))
            throw new Error('unsafe_reference_lifecycle_journal');
        this.db = new Database(file);
        try {
            this.db.pragma('journal_mode = DELETE');
            this.db.pragma('synchronous = FULL');
            const pageSize = this.db.pragma('page_size', { simple: true });
            if (!Number.isSafeInteger(pageSize) || pageSize < 512)
                throw new Error('unsafe_reference_lifecycle_page');
            const maximum = Math.floor(16 * 1024 * 1024 / pageSize);
            const actual = this.db.pragma(`max_page_count = ${maximum}`, { simple: true });
            const count = this.db.pragma('page_count', { simple: true });
            if (actual !== maximum || !Number.isSafeInteger(count) || count > maximum)
                throw new Error('reference_lifecycle_quota');
            this.db.exec('CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,owner TEXT NOT NULL,operation TEXT NOT NULL,payload TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,UNIQUE(owner,operation))');
            syncDirectoryTreeStrict(profileRoot);
        }
        catch (error) {
            this.db.close();
            throw error;
        }
    }
    begin(input) {
        if (!input.ownerId || !input.operationId || input.ownerId.length > 512 || input.operationId.length > 512 || !Number.isSafeInteger(input.deletedAt) || input.deletedAt < 0)
            throw new Error('invalid_deletion_receipt');
        const observations = mergeProtectedObservationClosures(undefined, { version: 1, requiresReauthorization: true, observations: input.references }).observations;
        if (input.hostOwnerId !== undefined && (typeof input.hostOwnerId !== 'string' || !input.hostOwnerId || input.hostOwnerId.length > 512))
            throw new Error('invalid_deletion_receipt');
        const payload = JSON.stringify({ ...(input.hostOwnerId ? { hostOwnerId: input.hostOwnerId } : {}), ownerId: input.ownerId, operationId: input.operationId, observations, deletedAt: input.deletedAt });
        const id = createHash('sha256').update(payload).digest('hex');
        this.db.transaction(() => { const prior = this.db.prepare('SELECT id,payload FROM receipts WHERE owner=? AND operation=?').get(input.ownerId, input.operationId); if (prior) {
            const old = JSON.parse(prior.payload), next = JSON.parse(payload);
            delete old.deletedAt;
            delete next.deletedAt;
            if (JSON.stringify(old) !== JSON.stringify(next))
                throw new Error('deletion_receipt_conflict');
            return;
        } this.db.prepare('INSERT INTO receipts(id,owner,operation,payload) VALUES(?,?,?,?)').run(id, input.ownerId, input.operationId, payload); })();
        return this.db.prepare('SELECT id FROM receipts WHERE owner=? AND operation=?').get(input.ownerId, input.operationId).id;
    }
    complete(id) { const changed = this.db.prepare('UPDATE receipts SET completed=1 WHERE id=?').run(id); if (!changed.changes)
        throw new Error('unknown_deletion_receipt'); }
    pending() { return this.db.prepare('SELECT id,owner,operation,payload FROM receipts WHERE completed=0').all().map(row => ({ id: row.id, ownerId: row.owner, operationId: row.operation, hostOwnerId: JSON.parse(row.payload).hostOwnerId })); }
    resolve(facts) {
        if (facts.referenceId !== `session:${facts.sourceSessionId}`)
            return { state: 'unknown' };
        for (const row of this.db.prepare('SELECT id,payload FROM receipts WHERE completed=1 AND owner=?').all(facts.referenceId)) {
            if (createHash('sha256').update(row.payload).digest('hex') !== row.id)
                throw new Error('corrupt_deletion_receipt');
            const parsed = JSON.parse(row.payload);
            if (parsed.ownerId !== facts.referenceId)
                continue;
            const observations = mergeProtectedObservationClosures(undefined, { version: 1, requiresReauthorization: true, observations: parsed.observations }).observations;
            if (!Number.isSafeInteger(parsed.deletedAt) || parsed.deletedAt < 0)
                throw new Error('corrupt_deletion_receipt');
            if (observations.some(ref => Object.keys(ref).every(key => ref[key] === facts[key])))
                return { state: 'deleted', deletionReceiptId: row.id, deletedAt: parsed.deletedAt };
        }
        return { state: 'unknown' };
    }
    close() { if (this.db.open)
        this.db.close(); }
}
