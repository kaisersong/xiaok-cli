import { assertVerificationDatabaseBudget, runVerificationTransaction } from './storage-budget.js';
import { randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { openPrivateVerificationDatabase } from './private-database.js';
import { canonicalVerificationJson, hashVerificationTuple, parseVerificationTuple, VERIFICATION_BUDGET, type VerificationTuple } from './protocol.js';
import type { ReceiverClockEvidence } from './receiver-store.js';
import { type AuthenticatedReceiverReply, createReceiverReplyVerifier } from './receiver-authentication.js';

type ReceiverVerifier = ReturnType<typeof createReceiverReplyVerifier>;
export interface PublicationState {
  reservation: 'pending' | 'commit_authorized' | 'consumed' | 'cancelled';
  outbox: 'ready' | 'dispatching' | 'receiver_committed' | 'delivery_unknown' | 'cancelled' | 'failed_before_dispatch';
  revocation: 'active' | 'revocation_pending' | 'revoked';
}
interface Row { operation_id: string; owner_key: string; tuple_hash: string; tuple_json: string; state_json: string; reply_json: string | null; challenge: string | null }
/** Private persistence layer. Only the protected completion coordinator may call mutation methods.
 * This is not a proof verifier or a public completion API; no product path is enabled by constructing it.
 */
export class VerificationPublicationJournal {
  private readonly db: Database;
  private readonly verifier: ReceiverVerifier;
  private closed = false;
  private readonly ownsDatabase: boolean;
  constructor(options: ({ root: string; database?: never } | { database: Database; root?: never }) & { receiverVerifier: ReceiverVerifier }) {
    this.verifier = options.receiverVerifier;
    this.ownsDatabase = !options.database;
    const db = options.database ?? openPrivateVerificationDatabase(options.root!);
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS publication_owner(owner_key TEXT PRIMARY KEY, revocation TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS publication_journal(operation_id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, tuple_hash TEXT NOT NULL, tuple_json TEXT NOT NULL, state_json TEXT NOT NULL, reply_json TEXT, challenge TEXT);
        CREATE INDEX IF NOT EXISTS publication_by_owner ON publication_journal(owner_key);`);
      if (!(db.prepare('PRAGMA table_info(publication_journal)').all() as { name: string }[]).some(x => x.name === 'challenge')) db.exec('ALTER TABLE publication_journal ADD COLUMN challenge TEXT');
      this.db = db;
    } catch (error) { if (this.ownsDatabase) db.close(); throw error; }
  }
  private assertOuterTransaction(): void {
    if (this.closed) throw Error('verification_journal_closed');
    if (!this.ownsDatabase && !this.db.inTransaction) throw Error('verification_outer_transaction_required');
  }
  private owner(tuple: Readonly<VerificationTuple>): string { return canonicalVerificationJson([tuple.profileId, tuple.ownerKind, tuple.ownerId, tuple.migrationEpoch]); }
  private row(tuple: Readonly<VerificationTuple>): Row | undefined {
    if (this.closed) throw Error('verification_journal_closed');
    const row = this.db.prepare('SELECT * FROM publication_journal WHERE operation_id=?').get(tuple.operationId) as Row | undefined;
    if (row && row.tuple_hash !== hashVerificationTuple(tuple)) throw Error('verification_journal_tuple_conflict'); return row;
  }
  private state(row: Row): PublicationState {
    const state = JSON.parse(row.state_json) as PublicationState;
    const owner = this.db.prepare('SELECT revocation FROM publication_owner WHERE owner_key=?').get(row.owner_key) as { revocation: PublicationState['revocation'] };
    return Object.freeze({ ...state, revocation: owner.revocation });
  }
  private write(row: Row, state: PublicationState, reply?: unknown): void {
    this.db.prepare('UPDATE publication_journal SET state_json=?,reply_json=COALESCE(?,reply_json) WHERE operation_id=?').run(canonicalVerificationJson(state), reply ? canonicalVerificationJson(reply) : null, row.operation_id);
  }
  /** Called only after the coordinator's complete proof/subject/obligation verification transaction. */
  recordCommittedSettlement(input: unknown): void {
    this.assertOuterTransaction();
    const tuple = parseVerificationTuple(input);
    runVerificationTransaction(this.db, () => {
      if (this.row(tuple)) return;
      const ownerKey = this.owner(tuple), owner = this.db.prepare('SELECT revocation FROM publication_owner WHERE owner_key=?').get(ownerKey) as { revocation: string } | undefined;
      if (owner && owner.revocation !== 'active') throw Error('verification_owner_invalidated');
      // Terminal history remains immutable for replay/conflict checks, but no longer
      // occupies a live dispatch slot. Unknown/nonterminal records never get evicted.
      const { count } = this.db.prepare("SELECT COUNT(*) count FROM publication_journal WHERE json_extract(state_json,'$.reservation') NOT IN ('consumed','cancelled')").get() as { count: number };
      if (count >= VERIFICATION_BUDGET.maximumOutboxRecords) throw Error('verification_journal_outbox_limit');
      assertVerificationDatabaseBudget(this.db, { additionalBytes: Buffer.byteLength(canonicalVerificationJson(tuple)) + 4096 });
      if (!owner) this.db.prepare('INSERT INTO publication_owner VALUES(?,?)').run(ownerKey, 'active');
      const state: PublicationState = { reservation: 'pending', outbox: 'ready', revocation: 'active' };
      this.db.prepare('INSERT INTO publication_journal VALUES(?,?,?,?,?,NULL,NULL)').run(tuple.operationId, ownerKey, hashVerificationTuple(tuple), canonicalVerificationJson(tuple), canonicalVerificationJson(state));
    });
  }
  authorizeReservation(input: unknown, clock: ReceiverClockEvidence): void {
    this.assertOuterTransaction();
    const tuple = parseVerificationTuple(input);
    runVerificationTransaction(this.db, () => {
      const row = this.row(tuple); if (!row) throw Error('verification_settlement_missing');
      const state = this.state(row);
      if (!clock || clock.domainId !== tuple.clockDomainId || clock.qualificationEpoch !== tuple.clockQualificationEpoch || !Number.isSafeInteger(clock.lowerBound) || !Number.isSafeInteger(clock.upperBound) || clock.lowerBound > clock.upperBound || clock.lowerBound < tuple.notBefore || clock.upperBound >= tuple.validUntil || !/^[a-f0-9]{64}$/.test(clock.evidenceHash) || state.revocation !== 'active') throw Error('verification_not_current');
      if (state.reservation !== 'pending' || state.outbox !== 'ready') throw Error('verification_already_dispatched');
      this.write(row, { ...state, reservation: 'commit_authorized', outbox: 'dispatching' });
    });
  }
  requestInvalidation(input: unknown): 'pending' | 'revoked' {
    const tuple = parseVerificationTuple(input);
    return runVerificationTransaction(this.db, () => {
      const row = this.row(tuple); if (!row) throw Error('verification_settlement_missing');
      this.db.prepare("UPDATE publication_owner SET revocation='revocation_pending' WHERE owner_key=? AND revocation='active'").run(row.owner_key);
      return this.finishInvalidation(row.owner_key);
    });
  }
  private finishInvalidation(ownerKey: string): 'pending' | 'revoked' {
    const rows = this.db.prepare('SELECT * FROM publication_journal WHERE owner_key=?').all(ownerKey) as Row[];
    // Even pending may already have staged receiver I/O. Only its authenticated
    // terminal reply can prove cancellation; startup/local timeout is not that fact.
    if (rows.some(row => ['pending', 'commit_authorized'].includes(this.state(row).reservation))) return 'pending';
    this.db.prepare("UPDATE publication_owner SET revocation='revoked' WHERE owner_key=?").run(ownerKey);
    return 'revoked';
  }
  issueReceiverChallenge(input: unknown): Readonly<{ fullTupleHash: string; challenge: string }> {
    const tuple = parseVerificationTuple(input);
    return runVerificationTransaction(this.db, () => {
      const row = this.row(tuple); if (!row) throw Error('verification_settlement_missing');
      const challenge = randomBytes(32).toString('hex');
      this.db.prepare('UPDATE publication_journal SET challenge=? WHERE operation_id=?').run(challenge, tuple.operationId);
      return Object.freeze({ fullTupleHash: row.tuple_hash, challenge });
    });
  }
  acceptReceiverReply(input: unknown, authenticated: AuthenticatedReceiverReply): void {
    const tuple = parseVerificationTuple(input), reply = this.verifier.read(authenticated);
    if (reply.receiverId !== tuple.receiverId || reply.receiverInstanceEpoch !== tuple.receiverInstanceEpoch || reply.fullTupleHash !== hashVerificationTuple(tuple)) throw Error('verification_reply_binding');
    runVerificationTransaction(this.db, () => {
      const row = this.row(tuple); if (!row) throw Error('verification_settlement_missing');
      if (!row.challenge || row.challenge !== reply.challenge) throw Error('verification_reply_challenge');
      const state = this.state(row), result = reply.result;
      if (result.status === 'unknown' || result.status === 'prepared') {
        if (state.reservation === 'commit_authorized') this.write(row, { ...state, outbox: 'delivery_unknown' }); return;
      }
      if (state.reservation === 'consumed' || state.reservation === 'cancelled') {
        if (state.reservation === 'cancelled' && result.status === 'cancelled' && !row.reply_json) {
          this.write(row, state, reply);
          if (state.revocation === 'revocation_pending') this.finishInvalidation(row.owner_key);
          return;
        }
        if (!row.reply_json || canonicalVerificationJson(JSON.parse(row.reply_json).result) !== canonicalVerificationJson(result)) throw Error('verification_conflicting_terminal'); return;
      }
      if (result.status === 'committed') {
        const clock = result.clock;
        if (state.reservation !== 'commit_authorized' || !clock || clock.domainId !== tuple.clockDomainId || clock.qualificationEpoch !== tuple.clockQualificationEpoch || clock.lowerBound < tuple.notBefore || clock.upperBound >= tuple.validUntil) throw Error('verification_reply_expired');
        this.write(row, { ...state, reservation: 'consumed', outbox: 'receiver_committed' }, reply);
      } else {
        this.write(row, { ...state, reservation: 'cancelled', outbox: 'cancelled' }, reply);
      }
      if (state.revocation === 'revocation_pending') this.finishInvalidation(row.owner_key);
    });
  }
  get(input: unknown): PublicationState | undefined { const row = this.row(parseVerificationTuple(input)); return row && this.state(row); }
  close(): void { if (!this.closed) { this.closed = true; if (this.ownsDatabase) this.db.close(); } }
}
