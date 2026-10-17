import { assertVerificationDatabaseBudget, runVerificationTransaction } from './storage-budget.js';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
import { canonicalVerificationJson, hashVerificationTuple, parseVerificationTuple, VERIFICATION_BUDGET, type VerificationTuple } from './protocol.js';

export interface ReceiverClockEvidence {
  domainId: string; qualificationEpoch: number; lowerBound: number; upperBound: number; evidenceHash: string;
}
export interface ReceiverResult {
  status: 'prepared' | 'committed' | 'cancelled'; fullTupleHash: string; objectRevision: number;
  reason?: 'user_cancelled' | 'expired' | 'clock_unavailable'; terminalRecordHash?: string; clock?: ReceiverClockEvidence;
}
interface StoredRow { tuple_hash: string; tuple_json: string; payload: string | null; result_json: string }
/** Service-private storage primitive, not an authenticated public endpoint or platform qualification. */
export class VerificationReceiverStore {
  private readonly db: Database;
  private readonly options: { receiverId: string; receiverInstanceEpoch: number; clock: () => unknown };
  private closed = false;
  private readonly lastClockLower = new Map<string, number>();
  constructor(options: { root: string; receiverId: string; receiverInstanceEpoch: number; clock: () => unknown }) {
    if (!options.receiverId || !Number.isSafeInteger(options.receiverInstanceEpoch) || options.receiverInstanceEpoch < 0 || typeof options.clock !== 'function') throw Error('receiver_options');
    this.options = { receiverId: options.receiverId, receiverInstanceEpoch: options.receiverInstanceEpoch, clock: options.clock };
    mkdirSync(options.root, { recursive: true, mode: 0o700 });
    if (lstatSync(options.root).isSymbolicLink() || !lstatSync(options.root).isDirectory()) throw Error('receiver_root_path');
    const root = realpathSync(options.root), path = join(root, 'authority.sqlite');
    for (const file of [path, path + '-journal', path + '-wal', path + '-shm']) {
      if (existsSync(file) && (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())) throw Error('receiver_store_path');
    }
    if (existsSync(path + '-wal') || existsSync(path + '-shm')) throw Error('receiver_unexpected_wal');
    const NativeDatabase = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3');
    const db = new NativeDatabase(path, { timeout: 0 });
    try {
      db.pragma('journal_mode = DELETE'); db.pragma('synchronous = FULL');
      const pageSize = db.pragma('page_size', { simple: true }) as number;
      const maxPages = Math.floor(VERIFICATION_BUDGET.controlDatabaseBytes / pageSize);
      const actual = db.pragma(`max_page_count = ${maxPages}`, { simple: true }) as number;
      if (actual > maxPages || (db.pragma('page_count', { simple: true }) as number) > maxPages) throw Error('receiver_database_limit');
      db.exec(`CREATE TABLE IF NOT EXISTS receiver_identity(id INTEGER PRIMARY KEY CHECK(id=1), receiver_id TEXT NOT NULL, epoch INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS receiver_operations(operation_id TEXT PRIMARY KEY, tuple_hash TEXT NOT NULL, tuple_json TEXT NOT NULL, payload TEXT, result_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS receiver_uploads(operation_id TEXT PRIMARY KEY,tuple_hash TEXT NOT NULL,tuple_json TEXT NOT NULL,total_bytes INTEGER NOT NULL,received_bytes INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS receiver_upload_chunks(operation_id TEXT NOT NULL,offset INTEGER NOT NULL,bytes BLOB NOT NULL,chunk_hash TEXT NOT NULL,PRIMARY KEY(operation_id,offset));
        CREATE TABLE IF NOT EXISTS receiver_visible(operation_id TEXT PRIMARY KEY REFERENCES receiver_operations(operation_id));
        CREATE TABLE IF NOT EXISTS receiver_business_completions(operation_id TEXT PRIMARY KEY REFERENCES receiver_operations(operation_id),owner_key TEXT NOT NULL,migration_epoch INTEGER NOT NULL,business_revision INTEGER NOT NULL,tuple_hash TEXT NOT NULL,payload_hash TEXT NOT NULL,UNIQUE(owner_key,migration_epoch,business_revision));
        CREATE TABLE IF NOT EXISTS receiver_clock_v2(domain_id TEXT NOT NULL, qualification_epoch INTEGER NOT NULL, lower_bound INTEGER NOT NULL, PRIMARY KEY(domain_id,qualification_epoch));`);
      runVerificationTransaction(db, () => {
        const identity = db.prepare('SELECT receiver_id,epoch FROM receiver_identity WHERE id=1').get() as { receiver_id: string; epoch: number } | undefined;
        if (identity && (identity.receiver_id !== options.receiverId || identity.epoch !== options.receiverInstanceEpoch)) throw Error('receiver_identity_mismatch');
        if (!identity) db.prepare('INSERT INTO receiver_identity VALUES(1,?,?)').run(options.receiverId, options.receiverInstanceEpoch);
      });
      syncDirectoryTreeStrict(root); this.db = db;
    } catch (error) { db.close(); throw error; }
  }
  private assertTuple(input: unknown, suppliedHash?: string): Readonly<VerificationTuple> {
    if (this.closed) throw Error('receiver_closed');
    const tuple = parseVerificationTuple(input);
    if (tuple.receiverId !== this.options.receiverId || tuple.receiverInstanceEpoch !== this.options.receiverInstanceEpoch || tuple.receiverId.startsWith('self:')) throw Error('receiver_identity_mismatch');
    if (suppliedHash !== undefined && suppliedHash !== hashVerificationTuple(tuple)) throw Error('receiver_full_tuple_hash');
    return tuple;
  }
  private row(tuple: Readonly<VerificationTuple>): StoredRow | undefined {
    const row = this.db.prepare('SELECT * FROM receiver_operations WHERE operation_id=?').get(tuple.operationId) as StoredRow | undefined;
    if (row && row.tuple_hash !== hashVerificationTuple(tuple)) throw Error('receiver_tuple_conflict');
    return row;
  }
  private result(row: StoredRow): ReceiverResult { return Object.freeze(JSON.parse(row.result_json)) as ReceiverResult; }
  private reserve(payloadBytes: number, replacedUpload?: string): void {
    const used = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(CAST(payload AS BLOB))),0) AS bytes FROM receiver_operations').get() as { count: number; bytes: number };
    const uploads=this.db.prepare('SELECT COUNT(*) count,COALESCE(SUM(total_bytes),0) bytes FROM receiver_uploads WHERE operation_id<>?').get(replacedUpload??'') as {count:number;bytes:number};
    if (used.count + uploads.count >= VERIFICATION_BUDGET.maximumOutboxRecords || used.bytes + uploads.bytes + payloadBytes > VERIFICATION_BUDGET.outboxPayloadBytes) throw Error('receiver_outbox_limit');
  }
  stage(input: unknown, payload: string): ReceiverResult {
    const tuple = this.assertTuple(input);
    if (typeof payload !== 'string' || Buffer.byteLength(payload) > VERIFICATION_BUDGET.outboxPayloadBytes || createHash('sha256').update(payload).digest('hex') !== tuple.immutablePayloadHash) throw Error('receiver_payload_hash');
    return runVerificationTransaction(this.db, () => {
      const existing = this.row(tuple); if (existing) return this.result(existing);
      const upload=this.db.prepare('SELECT tuple_hash,total_bytes FROM receiver_uploads WHERE operation_id=?').get(tuple.operationId) as {tuple_hash:string;total_bytes:number}|undefined;
      if(upload&&(upload.tuple_hash!==hashVerificationTuple(tuple)||(upload.total_bytes!==0&&upload.total_bytes!==Buffer.byteLength(payload))))throw Error('receiver_upload_binding');
      this.reserve(Buffer.byteLength(payload),tuple.operationId);
      assertVerificationDatabaseBudget(this.db, { additionalBytes: Buffer.byteLength(canonicalVerificationJson(tuple)) + Buffer.byteLength(payload) + 4096 });
      const result: ReceiverResult = { status: 'prepared', fullTupleHash: hashVerificationTuple(tuple), objectRevision: 1 };
      this.db.prepare('INSERT INTO receiver_operations VALUES(?,?,?,?,?)').run(tuple.operationId, result.fullTupleHash, canonicalVerificationJson(tuple), payload, canonicalVerificationJson(result));
      this.clearUpload(tuple.operationId);
      return Object.freeze(result);
    });
  }
  resolveRegisteredTuple(operationId:string,fullTupleHash:string):Readonly<VerificationTuple>|undefined{
    if(this.closed)throw Error('receiver_closed');
    if(typeof operationId!=='string'||!operationId||Buffer.byteLength(operationId)>160||/[\x00-\x1f\x7f]/.test(operationId)||!/^[a-f0-9]{64}$/.test(fullTupleHash))throw Error('receiver_reference');
    const row=this.db.prepare('SELECT tuple_hash,tuple_json FROM receiver_operations WHERE operation_id=? UNION ALL SELECT tuple_hash,tuple_json FROM receiver_uploads WHERE operation_id=?').all(operationId,operationId) as {tuple_hash:string;tuple_json:string}[];
    for(const r of row){if(r.tuple_hash!==fullTupleHash)throw Error('receiver_tuple_conflict');const tuple=this.assertTuple(JSON.parse(r.tuple_json),fullTupleHash);if(tuple.operationId!==operationId)throw Error('receiver_reference');}
    return row.length?this.assertTuple(JSON.parse(row[0].tuple_json),fullTupleHash):undefined;
  }
  registerUpload(input:unknown){
    const tuple=this.assertTuple(input),fullTupleHash=hashVerificationTuple(tuple);
    return runVerificationTransaction(this.db,()=>{
      this.resolveRegisteredTuple(tuple.operationId,fullTupleHash);
      const prior=this.row(tuple);if(prior){const size=prior.payload===null?0:Buffer.byteLength(prior.payload);return Object.freeze({fullTupleHash,totalBytes:size,receivedBytes:size});}
      const existing=this.db.prepare('SELECT total_bytes,received_bytes FROM receiver_uploads WHERE operation_id=?').get(tuple.operationId) as {total_bytes:number;received_bytes:number}|undefined;
      if(existing)return Object.freeze({fullTupleHash,totalBytes:existing.total_bytes,receivedBytes:existing.received_bytes});
      this.reserve(0);this.db.prepare('INSERT INTO receiver_uploads VALUES(?,?,?,0,0)').run(tuple.operationId,fullTupleHash,canonicalVerificationJson(tuple));
      assertVerificationDatabaseBudget(this.db,{additionalBytes:4096});return Object.freeze({fullTupleHash,totalBytes:0,receivedBytes:0});
    });
  }
  private clearUpload(operationId:string){this.db.prepare('DELETE FROM receiver_upload_chunks WHERE operation_id=?').run(operationId);this.db.prepare('DELETE FROM receiver_uploads WHERE operation_id=?').run(operationId);}
  /** Service-private durable staging; an upload is never a prepared business operation. */
  uploadChunk(input:{tuple:unknown;fullTupleHash:string;totalBytes:number;offset:number;chunkHash:string;bytes:Buffer}){
    const tuple=this.assertTuple(input.tuple,input.fullTupleHash),total=input.totalBytes,offset=input.offset,body=Buffer.from(input.bytes);
    if(!Buffer.isBuffer(input.bytes)||!Number.isSafeInteger(total)||total<1||total>VERIFICATION_BUDGET.outboxPayloadBytes||!Number.isSafeInteger(offset)||offset<0||body.length<1||body.length>256*1024||offset% (256*1024)!==0||body.length!==Math.min(256*1024,total-offset)||offset+body.length>total||createHash('sha256').update(body).digest('hex')!==input.chunkHash)throw Error('receiver_upload_chunk');
    return runVerificationTransaction(this.db,()=>{
      if(this.row(tuple))throw Error('receiver_upload_already_staged');
      let row=this.db.prepare('SELECT * FROM receiver_uploads WHERE operation_id=?').get(tuple.operationId) as {tuple_hash:string;total_bytes:number;received_bytes:number}|undefined;
      if(row&&(row.tuple_hash!==input.fullTupleHash||(row.total_bytes!==0&&row.total_bytes!==total)))throw Error('receiver_upload_binding');
      if(!row){
        if(offset!==0)throw Error('receiver_upload_gap');this.reserve(total);
        this.db.prepare('INSERT INTO receiver_uploads VALUES(?,?,?,?,0)').run(tuple.operationId,input.fullTupleHash,canonicalVerificationJson(tuple),total);
        assertVerificationDatabaseBudget(this.db,{additionalBytes:4096});row={tuple_hash:input.fullTupleHash,total_bytes:total,received_bytes:0};
      }
      if(row.total_bytes===0){if(offset!==0)throw Error('receiver_upload_gap');this.reserve(total,tuple.operationId);this.db.prepare('UPDATE receiver_uploads SET total_bytes=? WHERE operation_id=?').run(total,tuple.operationId);row.total_bytes=total;assertVerificationDatabaseBudget(this.db,{additionalBytes:4096});}
      const old=this.db.prepare('SELECT bytes,chunk_hash FROM receiver_upload_chunks WHERE operation_id=? AND offset=?').get(tuple.operationId,offset) as {bytes:Buffer;chunk_hash:string}|undefined;
      if(old){if(old.chunk_hash!==input.chunkHash||!old.bytes.equals(body))throw Error('receiver_upload_conflict');return Object.freeze({fullTupleHash:input.fullTupleHash,totalBytes:total,receivedBytes:row.received_bytes});}
      if(offset!==row.received_bytes)throw Error('receiver_upload_gap');
      this.db.prepare('INSERT INTO receiver_upload_chunks VALUES(?,?,?,?)').run(tuple.operationId,offset,body,input.chunkHash);
      const received=offset+body.length;this.db.prepare('UPDATE receiver_uploads SET received_bytes=? WHERE operation_id=?').run(received,tuple.operationId);
      assertVerificationDatabaseBudget(this.db,{additionalBytes:4096});
      return Object.freeze({fullTupleHash:input.fullTupleHash,totalBytes:total,receivedBytes:received});
    });
  }
  finishUpload(input:unknown,fullTupleHash:string):ReceiverResult{
    const tuple=this.assertTuple(input,fullTupleHash);
    return runVerificationTransaction(this.db,()=>{
      const existing=this.row(tuple);if(existing)return this.result(existing);
      const row=this.db.prepare('SELECT * FROM receiver_uploads WHERE operation_id=?').get(tuple.operationId) as {tuple_hash:string;total_bytes:number;received_bytes:number}|undefined;
      if(!row||row.total_bytes<1||row.tuple_hash!==fullTupleHash||row.received_bytes!==row.total_bytes)throw Error('receiver_upload_incomplete');
      const chunks=this.db.prepare('SELECT offset,bytes,chunk_hash FROM receiver_upload_chunks WHERE operation_id=? ORDER BY offset').all(tuple.operationId) as {offset:number;bytes:Buffer;chunk_hash:string}[];
      let offset=0;for(const chunk of chunks){if(chunk.offset!==offset||createHash('sha256').update(chunk.bytes).digest('hex')!==chunk.chunk_hash)throw Error('receiver_upload_corrupt');offset+=chunk.bytes.length;}
      if(offset!==row.total_bytes)throw Error('receiver_upload_incomplete');
      const bytes=Buffer.concat(chunks.map(c=>c.bytes),offset),payload=bytes.toString('utf8');
      if(!Buffer.from(payload).equals(bytes)||createHash('sha256').update(bytes).digest('hex')!==tuple.immutablePayloadHash)throw Error('receiver_upload_payload');
      // Remove the already reserved upload in this same transaction. Any stage
      // failure rolls deletion back; no concurrent writer observes a free slot.
      this.clearUpload(tuple.operationId);return this.stage(tuple,payload);
    });
  }
  private clock(tuple: Readonly<VerificationTuple>): ReceiverClockEvidence | undefined {
    let raw: unknown;
    try { raw = this.options.clock(); } catch { return undefined; }
    if (raw && typeof (raw as Promise<unknown>).then === 'function') { void Promise.resolve(raw).catch(() => {}); return undefined; }
    if (!raw || typeof raw !== 'object') return undefined;
    const value = raw as ReceiverClockEvidence;
    const clockKey = canonicalVerificationJson([tuple.clockDomainId, tuple.clockQualificationEpoch]);
    const previous = this.db.prepare('SELECT lower_bound FROM receiver_clock_v2 WHERE domain_id=? AND qualification_epoch=?').get(tuple.clockDomainId, tuple.clockQualificationEpoch) as { lower_bound: number } | undefined;
    if (value.domainId !== tuple.clockDomainId || value.qualificationEpoch !== tuple.clockQualificationEpoch ||
      !Number.isSafeInteger(value.lowerBound) || !Number.isSafeInteger(value.upperBound) || value.lowerBound < 0 || value.upperBound < value.lowerBound ||
      typeof value.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.evidenceHash) || value.lowerBound < Math.max(this.lastClockLower.get(clockKey) ?? -1, previous?.lower_bound ?? -1)) return undefined;
    this.lastClockLower.set(clockKey, value.lowerBound);
    this.db.prepare('INSERT INTO receiver_clock_v2 VALUES(?,?,?) ON CONFLICT(domain_id,qualification_epoch) DO UPDATE SET lower_bound=excluded.lower_bound').run(value.domainId, value.qualificationEpoch, value.lowerBound);
    return Object.freeze({ domainId: value.domainId, qualificationEpoch: value.qualificationEpoch, lowerBound: value.lowerBound, upperBound: value.upperBound, evidenceHash: value.evidenceHash });
  }
  private terminal(tuple: Readonly<VerificationTuple>, revision: number, status: 'committed' | 'cancelled', reason?: ReceiverResult['reason'], clock?: ReceiverClockEvidence): ReceiverResult {
    const content = { status, fullTupleHash: hashVerificationTuple(tuple), objectRevision: revision, ...(reason ? { reason } : {}), ...(clock ? { clock } : {}) };
    const result = Object.freeze({ ...content, terminalRecordHash: createHash('sha256').update(canonicalVerificationJson(content)).digest('hex') });
    this.db.prepare('UPDATE receiver_operations SET result_json=? WHERE operation_id=?').run(canonicalVerificationJson(result), tuple.operationId);
    return result;
  }
  commit(input: unknown, fullTupleHash: string, expectedRevision: number): ReceiverResult {
    const tuple = this.assertTuple(input, fullTupleHash);
    return runVerificationTransaction(this.db, () => {
      const row = this.row(tuple); if (!row) throw Error('receiver_not_prepared');
      const prior = this.result(row); if (prior.status !== 'prepared') return prior;
      if (prior.objectRevision !== expectedRevision) throw Error('receiver_stale_revision');
      const clock = this.clock(tuple);
      if (!clock || clock.lowerBound < tuple.notBefore) return this.terminal(tuple, prior.objectRevision + 1, 'cancelled', 'clock_unavailable');
      if (clock.upperBound >= tuple.validUntil) return this.terminal(tuple, prior.objectRevision + 1, 'cancelled', 'expired', clock);
      if (row.payload === null || createHash('sha256').update(row.payload).digest('hex') !== tuple.immutablePayloadHash) throw Error('receiver_payload_corrupt');
      const businessRevision=tuple.expectedBusinessRevision+1;if(!Number.isSafeInteger(businessRevision))throw Error('receiver_business_revision');
      const ownerKey=canonicalVerificationJson({profileId:tuple.profileId,ownerKind:tuple.ownerKind,ownerId:tuple.ownerId});
      assertVerificationDatabaseBudget(this.db,{additionalBytes:Buffer.byteLength(ownerKey)+2048});
      this.db.prepare('INSERT INTO receiver_business_completions VALUES(?,?,?,?,?,?)').run(tuple.operationId,ownerKey,tuple.migrationEpoch,businessRevision,fullTupleHash,tuple.immutablePayloadHash);
      this.db.prepare('INSERT INTO receiver_visible VALUES(?)').run(tuple.operationId);
      return this.terminal(tuple, prior.objectRevision + 1, 'committed', undefined, clock);
    });
  }
  cancel(input: unknown, fullTupleHash: string): ReceiverResult {
    const tuple = this.assertTuple(input, fullTupleHash);
    return runVerificationTransaction(this.db, () => {
      let row = this.row(tuple);
      if (!row) {
        const upload=this.db.prepare('SELECT tuple_hash FROM receiver_uploads WHERE operation_id=?').get(tuple.operationId) as {tuple_hash:string}|undefined;
        if(upload&&upload.tuple_hash!==fullTupleHash)throw Error('receiver_upload_binding');
        this.reserve(0,tuple.operationId);
        assertVerificationDatabaseBudget(this.db, { additionalBytes: Buffer.byteLength(canonicalVerificationJson(tuple)) + 4096 });
        this.db.prepare('INSERT INTO receiver_operations VALUES(?,?,?,?,?)').run(tuple.operationId, fullTupleHash, canonicalVerificationJson(tuple), null, canonicalVerificationJson({ status: 'prepared', fullTupleHash, objectRevision: 0 }));
        row = this.row(tuple)!;
      }
      const prior = this.result(row); if (prior.status !== 'prepared') return prior;
      const cancelled=this.terminal(tuple, prior.objectRevision + 1, 'cancelled', 'user_cancelled');this.clearUpload(tuple.operationId);return cancelled;
    });
  }
  query(input: unknown, fullTupleHash: string): ReceiverResult | undefined {
    const row = this.row(this.assertTuple(input, fullTupleHash)); return row && this.result(row);
  }
  readVisible(operationId: string): string | undefined {
    return (this.db.prepare('SELECT payload FROM receiver_operations JOIN receiver_visible USING(operation_id) WHERE operation_id=?').get(operationId) as { payload: string } | undefined)?.payload;
  }
  /** Historical receiver business commit, not a current verification observation.
   * The installed receiver authenticates the caller before exposing this lookup. */
  readBusinessCompletion(owner:{profileId:string;ownerKind:string;ownerId:string},operationId:string,fullTupleHash:string){
    if(this.closed)throw Error('receiver_closed');
    const row=this.db.prepare('SELECT b.*,o.tuple_json,o.payload,o.result_json FROM receiver_business_completions b JOIN receiver_operations o USING(operation_id) JOIN receiver_visible v USING(operation_id) WHERE b.operation_id=?').get(operationId) as {owner_key:string;migration_epoch:number;business_revision:number;tuple_hash:string;payload_hash:string;tuple_json:string;payload:string;result_json:string}|undefined;
    if(!row)return undefined;
    const tuple=this.assertTuple(JSON.parse(row.tuple_json),fullTupleHash),key=canonicalVerificationJson({profileId:tuple.profileId,ownerKind:tuple.ownerKind,ownerId:tuple.ownerId}),result=JSON.parse(row.result_json) as ReceiverResult;
    if(canonicalVerificationJson(owner)!==key||row.owner_key!==key||row.tuple_hash!==fullTupleHash||row.migration_epoch!==tuple.migrationEpoch||row.business_revision!==tuple.expectedBusinessRevision+1||row.payload_hash!==tuple.immutablePayloadHash||typeof row.payload!=='string'||createHash('sha256').update(row.payload).digest('hex')!==row.payload_hash||result.status!=='committed'||result.fullTupleHash!==fullTupleHash)throw Error('receiver_business_binding');
    const {terminalRecordHash,...content}=result;if(createHash('sha256').update(canonicalVerificationJson(content)).digest('hex')!==terminalRecordHash)throw Error('receiver_business_terminal');
    return Object.freeze({owner:Object.freeze(JSON.parse(key)),operationId,migrationEpoch:row.migration_epoch,businessRevision:row.business_revision,fullTupleHash,payload:row.payload,tuple,result:Object.freeze(result)});
  }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
