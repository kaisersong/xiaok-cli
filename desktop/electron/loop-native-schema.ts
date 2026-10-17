import type { DatabaseSync } from 'node:sqlite';
import { canonicalVerificationJson as json } from '../../src/runtime/verification/protocol.js';

/** Original journals are preserved verbatim; a new subtype can omit enrollment.
 * Rebuild without renaming the old table so dependent foreign keys retain their
 * original table name. All DDL and data checks share one writer transaction. */
export function migrateLoopNativeSchema(db: DatabaseSync): void {
  if (db.prepare('PRAGMA table_info(loop_native_attempts)').all().some(row => row.name === 'kind')) return;
  if (db.isTransaction) throw Error('loop_native_migration_outer_transaction');
  const fk = db.prepare('PRAGMA foreign_keys').get()?.foreign_keys;
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      // A second opener may have completed the migration while we waited.
      if (!db.prepare('PRAGMA table_info(loop_native_attempts)').all().some(row => row.name === 'kind')) {
        const original = db.prepare('SELECT * FROM loop_native_attempts ORDER BY attempt_id').all();
        const schema = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='loop_native_attempts' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all();
        db.exec(`CREATE TABLE loop_native_attempts_v2 (
          attempt_id text primary key, candidate_id text not null references loop_publication_candidates(candidate_id),
          revision integer not null, ordinal integer not null, original_source text not null,
          binding_hash text not null, source_vector_hash text not null, configuration_revision integer not null, definition_hash text not null,
          enrollment_request_id text unique, application_request_id text not null unique, phase text not null,
          created_at integer not null, updated_at integer not null,
          kind text not null default 'enrollment-and-application',
          enrollment_source_attempt_id text references loop_native_attempts(attempt_id),
          reauthorizes_attempt_id text references loop_native_attempts(attempt_id),
          unique(candidate_id,ordinal),
          CHECK ((kind='enrollment-and-application' AND enrollment_request_id IS NOT NULL AND enrollment_source_attempt_id IS NULL AND reauthorizes_attempt_id IS NULL)
            OR (kind='application-reauthorization' AND enrollment_request_id IS NULL AND enrollment_source_attempt_id IS NOT NULL AND reauthorizes_attempt_id IS NOT NULL))
        );
        INSERT INTO loop_native_attempts_v2 SELECT *, 'enrollment-and-application', NULL, NULL FROM loop_native_attempts;
        DROP TABLE loop_native_attempts;
        ALTER TABLE loop_native_attempts_v2 RENAME TO loop_native_attempts;`);
        for (const item of schema) db.exec(String(item.sql));
        const actual = db.prepare('SELECT * FROM loop_native_attempts ORDER BY attempt_id').all().map(({ kind, enrollment_source_attempt_id, reauthorizes_attempt_id, ...row }) => row);
        if (json(actual) !== json(original) || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('loop_native_migration_integrity');
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.exec(`PRAGMA foreign_keys=${fk ? 'ON' : 'OFF'}`); }
}
