import {join} from 'node:path';
import type {Database} from 'better-sqlite3';
import {canonicalVerificationJson as json, VERIFICATION_BUDGET} from './protocol.js';
import {assertVerificationDatabaseBudget} from './storage-budget.js';
import {migrationProfileDirectoryName} from './migration-markers.js';
import {MAIN_ROOT_FAMILY_PENDING_NAME, mainRootFamilyIntentKey, parseMainRootFamilyEnrollmentRecord, type MainRootFamilyEnrollmentRecord, type MainRootFamilyPrincipal} from './main-root-family-enrollment-data.js';

interface Intent {owner_key: string; profile_id: string; marker_json: string; state: string; published: number; charged_bytes: number}
/** Fixed sibling of the original migration journal. Its filesystem operations
 * are that journal's captured private operations, not RPC or caller-selected IO.
 * Pending projections never grant Root/family IO or fence ordinary writers. */
export function createMainRootFamilyJournal(input: {
  root: string; database: Database; authorityId: string;
  current(): void; directory(path: string): void; read(path: string): string | undefined;
  atomic(path: string, contents: string): void; sync(): void; exclusive<T>(work: () => T): T;
}) {
  const {database: db, authorityId} = input;
  const current = input.current, directory = input.directory, read = input.read, atomic = input.atomic;
  function row(key: string): Intent | undefined {
    return db.prepare('SELECT * FROM main.migration_publication_intents WHERE owner_key=?').get(key) as Intent | undefined;
  }
  function decode(value: Intent): Readonly<MainRootFamilyEnrollmentRecord> {
    const record = parseMainRootFamilyEnrollmentRecord(JSON.parse(value.marker_json));
    if (record.review.authorityId !== authorityId || value.owner_key !== mainRootFamilyIntentKey(record) || value.profile_id !== record.review.profileId || value.state !== 'pending' || ![0, 1].includes(value.published) || !Number.isSafeInteger(value.charged_bytes) || value.charged_bytes < 1) throw Error('main_root_enrollment_journal');
    return record;
  }
  function stored(record: Readonly<MainRootFamilyEnrollmentRecord>): Intent {
    const value = row(mainRootFamilyIntentKey(record));
    if (!value || value.marker_json !== json(record)) throw Error('main_root_enrollment_conflict');
    decode(value); return value;
  }
  function transaction() { if (!db.inTransaction) throw Error('main_root_enrollment_transaction'); }
  function readIntents(principal: Readonly<MainRootFamilyPrincipal>) {
    current();
    const rows = db.prepare("SELECT * FROM main.migration_publication_intents WHERE owner_key LIKE 'main-root-family:%' ORDER BY owner_key").all() as Intent[];
    const result = rows.map(decode).filter(record => record.review.principal.uid === principal.uid && record.review.principal.accountGeneration === principal.accountGeneration);
    current(); return Object.freeze(result);
  }
  return Object.freeze({
    readMainRootFamilyIntents: readIntents,
    prepareMainRootFamilyIntent(raw: MainRootFamilyEnrollmentRecord) {
      transaction(); const record = parseMainRootFamilyEnrollmentRecord(raw);
      if (record.review.authorityId !== authorityId || record.phase !== 'prepared') throw Error('main_root_enrollment_journal');
      current(); const key = mainRootFamilyIntentKey(record), old = row(key);
      if (readIntents(record.review.principal).some(prior => prior.requestId !== record.requestId && prior.phase !== 'cancelled')) throw Error('main_root_enrollment_conflict');
      if (old) { decode(old); if (old.marker_json !== json(record)) throw Error('main_root_enrollment_conflict'); return; }
      const usage = db.prepare('SELECT COUNT(*) n,COALESCE(SUM(charged_bytes),0) bytes,COUNT(DISTINCT profile_id) profiles FROM main.migration_publication_intents').get() as {n: number; bytes: number; profiles: number};
      const profile = !!db.prepare('SELECT 1 FROM main.migration_publication_intents WHERE profile_id=? LIMIT 1').get(record.review.profileId);
      const charge = 12288 + (profile ? 0 : 24576);
      if (usage.n >= 1024 || !profile && usage.profiles >= 64 || usage.bytes + charge > VERIFICATION_BUDGET.auxiliaryBytes) throw Error('migration_auxiliary_capacity');
      assertVerificationDatabaseBudget(db, {additionalBytes: 8192});
      db.prepare('INSERT INTO main.migration_publication_intents VALUES(?,?,?,?,0,?)').run(key, record.review.profileId, json(record), 'pending', charge);
      current();
    },
    replaceMainRootFamilyIntent(before: MainRootFamilyEnrollmentRecord, after: MainRootFamilyEnrollmentRecord) {
      transaction(); const old = parseMainRootFamilyEnrollmentRecord(before), next = parseMainRootFamilyEnrollmentRecord(after);
      if (old.boot !== next.boot || old.requestId !== next.requestId || json(old.review) !== json(next.review)) throw Error('main_root_enrollment_conflict');
      current(); stored(old);
      if (db.prepare("UPDATE main.migration_publication_intents SET marker_json=?,published=0 WHERE owner_key=? AND marker_json=? AND state='pending'").run(json(next), mainRootFamilyIntentKey(old), json(old)).changes !== 1) throw Error('main_root_enrollment_conflict');
      current();
    },
    publishMainRootFamilyPending(raw: MainRootFamilyEnrollmentRecord) {
      return input.exclusive(() => {
        if (db.inTransaction) throw Error('migration_publisher_outer_transaction');
        const record = parseMainRootFamilyEnrollmentRecord(raw); current(); stored(record);
        const profile = join(input.root, migrationProfileDirectoryName(record.review.profileId));
        directory(profile);
        const path = join(profile, MAIN_ROOT_FAMILY_PENDING_NAME), contents = json(record), prior = read(path);
        if (prior !== undefined) {
          const old = parseMainRootFamilyEnrollmentRecord(JSON.parse(prior));
          if (old.review.operationId !== record.review.operationId) {
            if (old.phase !== 'cancelled' || record.phase === 'cancelled' || old.review.profileId !== record.review.profileId || old.review.authorityId !== record.review.authorityId || old.review.principal.uid !== record.review.principal.uid || old.review.principal.accountGeneration !== record.review.principal.accountGeneration) throw Error('main_root_enrollment_superseded');
          } else if (json(old.review) !== json(record.review)) throw Error('main_root_enrollment_conflict');
        }
        current(); atomic(path, contents); current(); input.sync();
        return record;
      });
    },
    acknowledgeMainRootFamilyPending(raw: MainRootFamilyEnrollmentRecord) {
      transaction(); const record = parseMainRootFamilyEnrollmentRecord(raw); current(); stored(record);
      const path = join(input.root, migrationProfileDirectoryName(record.review.profileId), MAIN_ROOT_FAMILY_PENDING_NAME);
      if (read(path) !== json(record)) throw Error('main_root_enrollment_publication');
      db.prepare('UPDATE main.migration_publication_intents SET published=1 WHERE owner_key=? AND marker_json=?').run(mainRootFamilyIntentKey(record), json(record));
      current();
    },
  });
}
