import {assertLoopSQLiteReady,assertLoopSQLiteAutocommit} from './loop-sqlite-autocommit.js';
import type { DatabaseSync } from 'node:sqlite';
import {retainOriginalLoopDatabaseFailure,readOriginalLoopMigrationLease,type LoopDatabaseLease} from './loop-database-owner.js';
import { canonicalVerificationJson as json } from '../../src/runtime/verification/protocol.js';
const unknownMigrationCleanup=new Set<{db:DatabaseSync;primary:{raw:unknown};secondary:{raw:unknown}}>();

/** Original journals are preserved verbatim; a new subtype can omit enrollment.
 * Rebuild without renaming the old table so dependent foreign keys retain their
 * original table name. All DDL and data checks share one writer transaction. */
export function migrateLoopNativeSchema(db: DatabaseSync,lease?:LoopDatabaseLease): void {
  const writer=lease===undefined?undefined:readOriginalLoopMigrationLease(lease,db);
  assertLoopSQLiteReady();
  if (db.prepare('PRAGMA table_info(loop_native_attempts)').all().some(row => row.name === 'kind')) return;
  assertLoopSQLiteAutocommit(db, 'loop_native_migration_outer_transaction');
  const fk = db.prepare('PRAGMA foreign_keys').get()?.foreign_keys;
  if(writer)writer.execWrite('PRAGMA foreign_keys=OFF');else db.exec('PRAGMA foreign_keys=OFF');
  let failure:{raw:unknown}|undefined;
  try {
    if(writer)writer.execWrite('BEGIN IMMEDIATE');else db.exec('BEGIN IMMEDIATE');
    try {
      // A second opener may have completed the migration while we waited.
      if (!db.prepare('PRAGMA table_info(loop_native_attempts)').all().some(row => row.name === 'kind')) {
        const original = db.prepare('SELECT * FROM loop_native_attempts ORDER BY attempt_id').all();
        const schema = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='loop_native_attempts' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all();
        const sql=`CREATE TABLE loop_native_attempts_v2 (
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
        ALTER TABLE loop_native_attempts_v2 RENAME TO loop_native_attempts;`;
        if(writer)writer.execWrite(sql);else db.exec(sql);
        for (const item of schema) {const sql=String(item.sql);if(writer)writer.execWrite(sql);else db.exec(sql);}
        const actual = db.prepare('SELECT * FROM loop_native_attempts ORDER BY attempt_id').all().map(({ kind, enrollment_source_attempt_id, reauthorizes_attempt_id, ...row }) => row);
        if (json(actual) !== json(original) || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('loop_native_migration_integrity');
      }
      if(writer)writer.execWrite('COMMIT');else db.exec('COMMIT');
    } catch (error) { try{if(writer)writer.rollbackOwned();else db.exec('ROLLBACK');}catch(raw){if(!writer)unknownMigrationCleanup.add({db,primary:{raw:error},secondary:{raw}});}throw error; }
  } catch(raw){failure={raw};if(writer)retainOriginalLoopDatabaseFailure(writer,db,raw);}
  try{if(writer)writer.restoreForeignKeysOwned(!!fk);else db.exec(`PRAGMA foreign_keys=${fk ? 'ON' : 'OFF'}`);}catch(raw){if(!writer)unknownMigrationCleanup.add({db,primary:failure??{raw},secondary:{raw}});if(!failure)failure={raw};}
  if(failure)throw failure.raw;
}
