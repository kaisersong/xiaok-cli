import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { openPrivateVerificationDatabase } from '../verification/private-database.js';
import { VERIFICATION_BUDGET, canonicalVerificationJson } from '../verification/protocol.js';
import { assertVerificationDatabaseBudget, runVerificationTransaction } from '../verification/storage-budget.js';
import type { QuiescenceExpectation } from './physical-quiescence.js';

export interface ExecutionProposal {
  readonly sessionIdentity: string; readonly compoundOperationId: string; readonly validationInvocationId: string;
  readonly scopeDigest: string; readonly commandDigest: string; readonly materializationDigest: string;
  readonly engineBindingId: string; readonly engineEpoch: number; readonly imageId: string;
}
export interface ExecutionRecord {
  readonly expected: Readonly<QuiescenceExpectation>;
  readonly proposal: Readonly<ExecutionProposal>;
  readonly state: 'prepared' | 'creating' | 'created' | 'starting' | 'running' | 'unknown' | 'cancelling-created' | 'terminal';
  readonly containerId?: string;
  readonly exitCode?: number;
  readonly cancelledBeforeStart?: true;
}
interface Row { execution_id: string; session_id: string; operation_id: string; proposal_json: string; state: ExecutionRecord['state']; container_id: string | null; exit_code: number | null }
/** Service-private journal. These mutations are not public RPCs and never issue a physical receipt. */
export class ExecutionJournal {
  private readonly db: Database;
  private closed = false;
  private readonly ownsDatabase: boolean;
  constructor(input: string | { database: Database }) {
    this.ownsDatabase = typeof input === 'string';
    const db = typeof input === 'string' ? openPrivateVerificationDatabase(input) : input.database;
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS execution_attempts(execution_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, operation_id TEXT NOT NULL, proposal_json TEXT NOT NULL, state TEXT NOT NULL, container_id TEXT, exit_code INTEGER);
        CREATE UNIQUE INDEX IF NOT EXISTS execution_one_active ON execution_attempts(session_id,operation_id) WHERE state!='terminal';`);
      this.db = db;
    } catch (error) { if (this.ownsDatabase) db.close(); throw error; }
  }
  private row(expected: QuiescenceExpectation): Row {
    if (this.closed) throw Error('execution_journal_closed');
    const row = this.db.prepare('SELECT * FROM execution_attempts WHERE execution_id=?').get(expected.executionIdentity) as Row | undefined;
    if (!row) throw Error('execution_not_found');
    const proposal = JSON.parse(row.proposal_json) as ExecutionProposal;
    if (expected.sessionIdentity !== proposal.sessionIdentity || expected.compoundOperationId !== proposal.compoundOperationId || expected.validationInvocationId !== proposal.validationInvocationId || expected.scopeDigest !== proposal.scopeDigest) throw Error('execution_identity_mismatch');
    return row;
  }
  private record(row: Row): ExecutionRecord {
    const proposal = Object.freeze(JSON.parse(row.proposal_json)) as ExecutionProposal;
    return Object.freeze({ expected: Object.freeze({ sessionIdentity: proposal.sessionIdentity, compoundOperationId: proposal.compoundOperationId, validationInvocationId: proposal.validationInvocationId, executionIdentity: row.execution_id, scopeDigest: proposal.scopeDigest }), proposal, state: row.state, ...(row.container_id ? { containerId: row.container_id } : {}), ...(row.exit_code === null ? (row.state==='terminal'?{cancelledBeforeStart:true as const}:{}) : { exitCode: row.exit_code }) });
  }
  reserve(input: ExecutionProposal): ExecutionRecord {
    const keys = ['sessionIdentity', 'compoundOperationId', 'validationInvocationId', 'scopeDigest', 'commandDigest', 'materializationDigest', 'engineBindingId', 'engineEpoch', 'imageId'];
    if (!input || Object.keys(input).length !== keys.length || keys.some(k => !Object.hasOwn(input, k)) || Object.values(Object.getOwnPropertyDescriptors(input)).some(d => !('value' in d))) throw Error('execution_proposal');
    for (const key of ['sessionIdentity', 'compoundOperationId', 'validationInvocationId', 'engineBindingId'] as const) if (typeof input[key] !== 'string' || !input[key].length || Buffer.byteLength(input[key]) > 160 || /[\x00-\x1f\x7f]/.test(input[key])) throw Error('execution_proposal');
    for (const key of ['scopeDigest', 'commandDigest', 'materializationDigest'] as const) if (typeof input[key] !== 'string' || !/^[a-f0-9]{64}$/.test(input[key])) throw Error('execution_proposal');
    if (!Number.isSafeInteger(input.engineEpoch) || input.engineEpoch < 1 || !/^sha256:[a-f0-9]{64}$/.test(input.imageId)) throw Error('execution_proposal');
    const json = canonicalVerificationJson(input);
    return runVerificationTransaction(this.db, () => {
      const prior = (this.db.prepare('SELECT * FROM execution_attempts WHERE session_id=? AND operation_id=?').all(input.sessionIdentity, input.compoundOperationId) as Row[]).find(row => (JSON.parse(row.proposal_json) as ExecutionProposal).validationInvocationId === input.validationInvocationId);
      if (prior) { if (prior.proposal_json !== json) throw Error('execution_proposal_conflict'); return this.record(prior); }
      if (this.db.prepare("SELECT 1 FROM execution_attempts WHERE session_id=? AND operation_id=? AND state!='terminal'").get(input.sessionIdentity, input.compoundOperationId)) throw Error('execution_active');
      const count = (this.db.prepare('SELECT COUNT(*) AS n FROM execution_attempts').get() as { n: number }).n;
      if (count >= VERIFICATION_BUDGET.maximumExecutionAttempts) throw Error('verification_capacity_exhausted');
      assertVerificationDatabaseBudget(this.db, { additionalBytes: Buffer.byteLength(json) + 4096 });
      const identity = randomUUID();
      this.db.prepare("INSERT INTO execution_attempts VALUES(?,?,?,?,'prepared',NULL,NULL)").run(identity, input.sessionIdentity, input.compoundOperationId, json);
      return this.read({ ...input, executionIdentity: identity });
    });
  }
  findActive(sessionIdentity: string, compoundOperationId: string): ExecutionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM execution_attempts WHERE session_id=? AND operation_id=? AND state!='terminal'").get(sessionIdentity, compoundOperationId) as Row | undefined;
    return row && this.record(row);
  }
  /** Durable prepared means beginDispatch never committed: no engine create/start may have been issued. */
  cancelPrepared(expected: QuiescenceExpectation): void { this.transition(expected, 'prepared', 'terminal'); }
  /** Durable start intent was never issued. Caller must inspect/remove the exact
   * container, then confirm absence before recordCancelledCreated. No exit proof. */
  beginCancelCreated(expected:QuiescenceExpectation,containerId:string):void {
    runVerificationTransaction(this.db,()=>{const row=this.row(expected);if(row.container_id!==containerId||row.state!=='created')throw Error('execution_state');this.transition(expected,'created','cancelling-created');});
  }
  recordCancelledCreated(expected:QuiescenceExpectation,containerId:string):void {
    runVerificationTransaction(this.db,()=>{const row=this.row(expected);if(row.container_id!==containerId||row.state!=='cancelling-created'||row.exit_code!==null)throw Error('execution_state');this.transition(expected,'cancelling-created','terminal');});
  }
  /** Private supervisor only, after matching the recovered container's full host nonce/scope/image facts. */
  reconcileContainer(expected: QuiescenceExpectation, fact: { containerId: string; engineBindingId: string; engineEpoch: number }): void {
    if (!/^[a-f0-9]{64}$/.test(fact.containerId)) throw Error('execution_container_identity');
    runVerificationTransaction(this.db, () => {
      const row = this.row(expected); const proposal = JSON.parse(row.proposal_json) as ExecutionProposal;
      if (fact.engineBindingId !== proposal.engineBindingId || fact.engineEpoch !== proposal.engineEpoch) throw Error('execution_engine_mismatch');
      if (row.state !== 'unknown' || (row.container_id !== null && row.container_id !== fact.containerId)) throw Error('execution_state');
      this.db.prepare('UPDATE execution_attempts SET container_id=? WHERE execution_id=?').run(fact.containerId, expected.executionIdentity);
    });
  }
  read(expected: QuiescenceExpectation): ExecutionRecord { return this.record(this.row(expected)); }
  private transition(expected: QuiescenceExpectation, from: ExecutionRecord['state'], to: ExecutionRecord['state'], containerId?: string): void {
    runVerificationTransaction(this.db, () => {
      const row = this.row(expected);
      if (row.state !== from) throw Error(from === 'prepared' && to === 'creating' ? 'execution_dispatch_already_consumed' : 'execution_state');
      this.db.prepare('UPDATE execution_attempts SET state=?,container_id=COALESCE(?,container_id) WHERE execution_id=?').run(to, containerId ?? null, expected.executionIdentity);
    });
  }
  beginDispatch(expected: QuiescenceExpectation): void { this.transition(expected, 'prepared', 'creating'); }
  bindContainer(expected: QuiescenceExpectation, containerId: string): void {
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw Error('execution_container_identity');
    this.transition(expected, 'creating', 'created', containerId);
  }
  markStartRequested(expected: QuiescenceExpectation): void { this.transition(expected, 'created', 'starting'); }
  markRunning(expected: QuiescenceExpectation): void { this.transition(expected, 'starting', 'running'); }
  markUnknown(expected: QuiescenceExpectation): void {
    runVerificationTransaction(this.db, () => { const row = this.row(expected); if (row.state === 'terminal' || row.state === 'cancelling-created') return; this.db.prepare("UPDATE execution_attempts SET state='unknown' WHERE execution_id=?").run(expected.executionIdentity); });
  }
  /** Only the protected engine supervisor calls this after checking the exact engine/container identity. */
  recordPhysicalTerminal(expected: QuiescenceExpectation, containerId: string, exitCode: number): void {
    if (!Number.isSafeInteger(exitCode)) throw Error('execution_exit_code');
    runVerificationTransaction(this.db, () => {
      const row = this.row(expected);
      if (row.container_id !== containerId || !['starting', 'running', 'unknown', 'terminal'].includes(row.state)) throw Error('execution_state');
      if (row.state === 'terminal' && row.exit_code !== exitCode) throw Error('execution_terminal_conflict');
      this.db.prepare("UPDATE execution_attempts SET state='terminal',exit_code=? WHERE execution_id=?").run(exitCode, expected.executionIdentity);
    });
  }
  /** Call once under the daemon's exclusive lifetime lock; never from an arbitrary second connection. */
  recoverInterrupted(): void { runVerificationTransaction(this.db, () => {this.db.prepare("UPDATE execution_attempts SET state='cancelling-created' WHERE state='created'").run();this.db.prepare("UPDATE execution_attempts SET state='unknown' WHERE state IN ('creating','starting','running')").run();}); }
  close(): void { if (!this.closed) { this.closed = true; if (this.ownsDatabase) this.db.close(); } }
}
