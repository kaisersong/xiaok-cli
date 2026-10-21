import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { openPrivateVerificationDatabase } from './private-database.js';
import { canonicalVerificationJson, VERIFICATION_BUDGET } from './protocol.js';
import { assertVerificationDatabaseBudget, runVerificationTransaction } from './storage-budget.js';
export type ControllerRequestSource = 'user' | 'agent' | 'scheduler';
export interface ControllerGrant { readonly id: string; readonly secret: string }
export interface ControllerCaller { readonly principalId: string; readonly requestSource: ControllerRequestSource; readonly grantId: string }
interface Row { id: string; secret_hash: string; principal_id: string; request_source: ControllerRequestSource; method: string; payload_hash: string; expires_at: number; state: 'issued' | 'consumed' | 'revoked' }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function payloadHash(payload: unknown): string { const text = canonicalVerificationJson(payload); if (Buffer.byteLength(text) > VERIFICATION_BUDGET.rpcBytes) throw Error('controller_payload_limit'); return hash(text); }
/** issue/revoke are host-private and must NEVER be registered as client RPC methods. */
export class ControllerGrantStore {
  private readonly db: Database;
  private closed = false;
  constructor(root: string) {
    const db = openPrivateVerificationDatabase(root);
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS controller_grants(id TEXT PRIMARY KEY,secret_hash TEXT NOT NULL,principal_id TEXT NOT NULL,request_source TEXT NOT NULL,method TEXT NOT NULL,payload_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS controller_grant_clock(id INTEGER PRIMARY KEY CHECK(id=1),last_seen INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS controller_grant_audit(id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,request_source TEXT NOT NULL,method TEXT NOT NULL,payload_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL);`);
      this.db = db;
    } catch (error) { db.close(); throw error; }
  }
  /** Raw host time input must come from the daemon's qualified clock; this store cannot qualify clocks. */
  private observeClock(now: number): void {
    if (!Number.isSafeInteger(now) || now < 0) throw Error('controller_clock_invalid');
    runVerificationTransaction(this.db, () => {
      const clock = this.db.prepare('SELECT last_seen FROM controller_grant_clock WHERE id=1').get() as { last_seen: number } | undefined;
      if (clock && now < clock.last_seen) throw Error('controller_clock_regressed');
      this.db.prepare('INSERT INTO controller_grant_clock VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen').run(now);
    });
  }
  issue(input: { principalId: string; requestSource: ControllerRequestSource; method: string; payload: unknown; expiresAt: number }, now: number): ControllerGrant {
    this.observeClock(now);
    if (typeof input.principalId !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(input.principalId) || !['user', 'agent', 'scheduler'].includes(input.requestSource) || typeof input.method !== 'string' || !/^[a-z]+(?:\.[a-z]+)+$/.test(input.method) || input.method.length > 80 || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now || input.expiresAt - now > 300000) throw Error('controller_grant_input');
    const digest = payloadHash(input.payload);
    this.collectExpired(now);
    return runVerificationTransaction(this.db, () => {
      if ((this.db.prepare('SELECT COUNT(*) AS n FROM controller_grants').get() as { n: number }).n >= 4096) throw Error('verification_capacity_exhausted');
      assertVerificationDatabaseBudget(this.db, { additionalBytes: 4096 });
      const id = randomUUID(), secret = randomBytes(32).toString('hex');
      this.db.prepare("INSERT INTO controller_grants VALUES(?,?,?,?,?,?,?,'issued')").run(id, hash(secret), input.principalId, input.requestSource, input.method, digest, input.expiresAt);
      return Object.freeze({ id, secret });
    });
  }
  /** Expiry frees active slots only; minimum operation/source/outcome audit is retained permanently. */
  collectExpired(now: number): void {
    this.observeClock(now);
    runVerificationTransaction(this.db, () => {
      const count = (this.db.prepare('SELECT COUNT(*) AS n FROM controller_grants WHERE expires_at<=?').get(now) as { n: number }).n;
      if (!count) return;
      assertVerificationDatabaseBudget(this.db, { additionalBytes: count * 1024 });
      this.db.prepare('INSERT INTO controller_grant_audit SELECT id,principal_id,request_source,method,payload_hash,expires_at,state FROM controller_grants WHERE expires_at<=?').run(now);
      this.db.prepare('DELETE FROM controller_grants WHERE expires_at<=?').run(now);
    });
  }
  consume(grant: ControllerGrant, method: string, payload: unknown, now: number): ControllerCaller {
    this.observeClock(now);
    if (!grant || typeof grant.id !== 'string' || typeof grant.secret !== 'string' || !/^[a-f0-9]{64}$/.test(grant.secret)) throw Error('controller_grant_mismatch');
    const digest = payloadHash(payload);
    return runVerificationTransaction(this.db, () => {
      const clock = this.db.prepare('SELECT last_seen FROM controller_grant_clock WHERE id=1').get() as { last_seen: number };
      if (now < clock.last_seen) throw Error('controller_clock_regressed');
      const row = this.db.prepare('SELECT * FROM controller_grants WHERE id=?').get(grant.id) as Row | undefined;
      if (!row || !timingSafeEqual(Buffer.from(hash(grant.secret), 'hex'), Buffer.from(row.secret_hash, 'hex')) || method !== row.method || digest !== row.payload_hash) throw Error('controller_grant_mismatch');
      if (row.state !== 'issued') throw Error('controller_grant_' + row.state);
      if (now >= row.expires_at) throw Error('controller_grant_expired');
      this.db.prepare("UPDATE controller_grants SET state='consumed' WHERE id=?").run(grant.id);
      return Object.freeze({ principalId: row.principal_id, requestSource: row.request_source, grantId: row.id });
    });
  }
  revokePrincipal(principalId: string): void { runVerificationTransaction(this.db, () => { this.db.prepare("UPDATE controller_grants SET state='revoked' WHERE principal_id=? AND state='issued'").run(principalId); }); }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
