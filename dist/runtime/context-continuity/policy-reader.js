import { DatabaseSync } from 'node:sqlite';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { readContinuityProfile } from './profile-identity.js';
import { assertContinuityTaskReadable } from './policy.js';
/** Reads committed main policy only. Never migrates, creates, repairs, or caches allow. */
export class ContinuityPolicyReader {
    options;
    constructor(options) {
        this.options = options;
    }
    assertTaskReadable(taskId) { this.assertTasksReadable([taskId]); }
    assertTasksReadable(taskIds) {
        let db;
        try {
            if (!Array.isArray(taskIds) || taskIds.length < 1 || taskIds.length > 512)
                throw new Error();
            const root = lstatSync(this.options.dataRoot);
            if (!root.isDirectory() || root.isSymbolicLink() || typeof process.getuid === 'function' && root.uid !== process.getuid())
                throw new Error();
            const file = join(this.options.dataRoot, 'continuity.sqlite');
            const secure = (path) => {
                const state = lstatSync(path);
                if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || typeof process.getuid === 'function' && (state.uid !== process.getuid() || (state.mode & 0o077) !== 0))
                    throw new Error();
                return state;
            };
            secure(join(this.options.dataRoot, 'continuity-profile.json'));
            if (readContinuityProfile(this.options.dataRoot) !== this.options.profileId)
                throw new Error();
            const before = secure(file);
            const optional = (path) => { try {
                return secure(path);
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return undefined;
                throw error;
            } };
            const wal = optional(file + '-wal'), shm = optional(file + '-shm'), journal = optional(file + '-journal');
            if (!wal || !shm || journal)
                throw new Error();
            // Absence of WAL is not an immutable-file guarantee across processes.
            // Offline positive reads await a qualified writer-exclusion mechanism.
            db = new DatabaseSync(file, { readOnly: true });
            const opened = secure(file);
            if (before.dev !== opened.dev || before.ino !== opened.ino)
                throw new Error();
            db.exec('BEGIN');
            const meta = (key) => db.prepare('SELECT value FROM continuity_meta WHERE key=?').get(key)?.value;
            if (meta('profileId') !== this.options.profileId || meta('schemaVersion') !== '1' || meta('effectReceiptPolicy') !== '2')
                throw new Error();
            // Missing or body-incomplete policy tables fail even for an otherwise clean task.
            for (const table of ['effect_owner_receipts', 'effect_history_dependencies'])
                if (!db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === 'snapshot_hash'))
                    throw new Error();
            for (const id of new Set(taskIds))
                assertContinuityTaskReadable(id, { db, scope: this.options.scope });
            // No invalidation callback: only main's write owner persists sticky failures.
            db.exec('ROLLBACK');
        }
        catch {
            throw new Error('not_readable');
        }
        finally {
            db?.close();
        }
    }
}
