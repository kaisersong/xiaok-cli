import {migrateAssistantDigestReceipts,getAssistantDigestReceipt,claimAssistantDigest,finishAssistantDigest} from '../assistant/digest-receipts.js';
import { pathToFileURL } from 'node:url';
import { activityReadonlyNeedsSnapshot, createActivityReadonlySnapshot } from './readonly-snapshot.js';
import { chmodPrivateActivityFile, createPrivateActivityDirectory } from './storage-permissions.js';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, realpathSync, openSync, closeSync, chmodSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { ActivityOrigin, ConversationActivity, ReportingPreference, WorkBinding, WorkEvent, WorkProjection, WorkWatch } from './types.js';
import type { SerializedTaskReference } from '@modelcontextprotocol/ext-tasks/client';
import {ATTENTION_PRESENTATION_SQL,createAttentionPresentationStore,type AttentionPresentationRebuild,type AttentionReadFinalization,type ProjectAttentionFinalization} from './attention-presentation-store.js';
import {ATTENTION_CANONICAL_SQL} from './attention-canonical-state.js';
import {ORDINARY_ATTENTION_FACT_SQL,createOrdinaryAttentionFacts,ordinaryEventWitness,type OrdinaryStateWitness} from './ordinary-attention-facts.js';
import {NATIVE_ATTENTION_SOURCE_SQL,enrollNativeAttentionSourceLocked,readNativeAttentionEnrollment,nativeApprovalOwnerMatchesReference,markNativeAttentionCoverageLostLocked,markNativeAttentionCoverageUnknownLocked,type NativeAttentionEnrollment,type NativeActivitySourceDelivery} from './native-attention-source.js';
import {nativeApprovalOwnerSchema} from '../task-host/native-approval-owner.js';
import {saveActivityProjectionLocked,refreshActivityCardLocked} from './activity-projection-locked.js';
import {nativeTerminalInventoryLocked} from './native-attention-terminal.js';
import {PROJECT_DELIVERY_FACT_SQL,createProjectDeliveryFacts,hasProjectDeliveryLineage} from './project-delivery-facts.js';
import {parseScopedProjectActivityPage} from './project-scoped-activity-data.js';
import {parseProjectActivityPage} from './project-delivery-data.js';
import {assertBeforeEffects} from '../verification/before-effects.js';
import {projectActivityAttention} from './attention-projector.js';
import {parseProjectForwardStamp,projectForwardDigest,type ProjectForwardStamp} from './project-forward-snapshot-data.js';

/** Host-local private frame resolver, fixed at Store construction. Never IPC. */
export type ProjectDeliveryStoreSource=(frame:object)=>Readonly<{
  watchId:string;body:unknown;after:number;demandId:string;assertCurrent():void;
}>;
export type ProjectOrdinaryStoreSource=(frame:object)=>Readonly<{watchId:string;page:unknown;after:number;assertCurrent():void}>;
type ProjectOrdinaryWriteCapability=Readonly<{kind:'project_ordinary_write_v1'}>;
type ActivitySourceDelivery=NativeActivitySourceDelivery|ProjectOrdinaryWriteCapability;

const REPORT_INTERVAL = 5 * 60_000;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const KINDS = new Set(['accepted', 'started', 'heartbeat', 'progress', 'artifact_available', 'blocked', 'input_required', 'completed', 'failed', 'cancelled']);
const CRITICAL = new Set(['accepted', 'started', 'artifact_available', 'blocked', 'input_required', 'completed', 'failed', 'cancelled']);
const encode = (value: unknown): string => JSON.stringify(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const digest = (value: unknown): string => createHash('sha256').update(encode(value)).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;

// Host-private diagnostics only. Never serialize raw errors through IPC/preload.
interface ActivityStoreCleanupDiagnostic {
  readonly sequence: number;
  readonly phase: 'begin' | 'commit' | 'rollback' | 'secure-sidecars' | 'readonly-close' | 'data-close' | 'owner-close';
  readonly stage: 'constructor-cleanup' | 'begin-threw' | 'body-failed' | 'commit-threw' | 'commit-returned' | 'readonly-cleanup';
  readonly relation: 'secondary' | 'primary-after-commit' | 'primary-state-unknown';
}
const activityStoreCleanupDiagnostics: Readonly<ActivityStoreCleanupDiagnostic>[] = [];
const retainedActivityStoreConstructions = new Set<Readonly<{ data?: DatabaseSync; owner?: DatabaseSync }>>();
let cleanupSequence = 0, cleanupDiagnosticsDropped = 0, cleanupDiagnosticLogFailures = 0;
function recordActivityStoreCleanupFailure(
  phase: ActivityStoreCleanupDiagnostic['phase'], stage: ActivityStoreCleanupDiagnostic['stage'],
  relation: ActivityStoreCleanupDiagnostic['relation'] = 'secondary',
): void {
  const sequence = ++cleanupSequence;
  try {
    if (activityStoreCleanupDiagnostics.length === 32) { activityStoreCleanupDiagnostics.shift(); cleanupDiagnosticsDropped += 1; }
    activityStoreCleanupDiagnostics.push(Object.freeze({ sequence, phase, stage, relation }));
  } catch { cleanupDiagnosticsDropped += 1; }
  // Stable metadata only; original SQL/error/cause objects remain host-private.
  try { console.error('[conversation-activity] activity_store_cleanup_failed', { sequence, phase, stage, relation, dropped: cleanupDiagnosticsDropped, logFailures: cleanupDiagnosticLogFailures, retainedConstructions: retainedActivityStoreConstructions.size }); }
  catch { cleanupDiagnosticLogFailures += 1; }
}
function closeFailedActivityStoreConstruction(
  data: DatabaseSync | undefined, owner: DatabaseSync | undefined,
  dataPhase: 'readonly-close' | 'data-close' = 'data-close',
): void {
  const retained = Object.freeze({ data, owner });
  retainedActivityStoreConstructions.add(retained); // Keep actual handles, never PID-derived replacements.
  let dataClosed = data === undefined, ownerClosed = owner === undefined;
  if (data) {
    try { data.close(); dataClosed = true; }
    catch { recordActivityStoreCleanupFailure(dataPhase, 'constructor-cleanup'); }
  }
  // The owner lock is dependent on actual writer close, not an independent disposer.
  if (dataClosed && owner) {
    try { owner.close(); ownerClosed = true; }
    catch { recordActivityStoreCleanupFailure('owner-close', 'constructor-cleanup'); }
  }
  if (dataClosed && ownerClosed) retainedActivityStoreConstructions.delete(retained);
  // No retry, forced release, public handle, or false physical-close ACK.
}

/** Single host owner. IPC and source admission belong to the service above this store. */
export class ConversationActivityStore {
  private readonly db: DatabaseSync;
  private readonly owner?: DatabaseSync;
  private readonly readOnly: boolean;
  private readonly readonlySnapshot?: ReturnType<typeof createActivityReadonlySnapshot>;
  private readonly now: () => number;
  private readonly maxSourceEvents: number;
  private closed = false;
  // Failure-derived latch; no reset/force/grant API. Reads remain available.
  private writeState: 'writable' | 'unconfirmed' | 'committed-unverified' = 'writable';
  private file!: string;
  private attentionMetadata?:ReturnType<typeof createAttentionPresentationStore>;
  private nativeDeliveries=new WeakMap<NativeActivitySourceDelivery,NativeAttentionEnrollment>();
  private readonly projectDeliverySource?:ProjectDeliveryStoreSource;
  private readonly projectOrdinarySource?:ProjectOrdinaryStoreSource;
  private readonly projectWrites=new WeakMap<ProjectOrdinaryWriteCapability,{watchId:string;identity:string;assertCurrent():void;page:ReturnType<typeof parseProjectActivityPage>;after:number;step:'retained'|'snapshot'|'fresh';retained:object;snapshot?:{epoch:string;sequence:number;state:WorkProjection['executionState']}}>();
  private projectDeliveryMetadata?:ReturnType<typeof createProjectDeliveryFacts>;
  private readonly projectDeliveryReads=new WeakMap<object,Readonly<{frame:object;membershipDigest:string;witnessDigest:string;presentationIncarnation:string;projectionVersion:number;dismissed:boolean;viewDigest:string}>>();
  private projectSnapshotUnconfirmed=false;

  private secureSidecars(): void {
    if (this.readOnly) return;
    for (const base of [this.file, `${this.file}.owner.sqlite`]) for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const path = base + suffix;
      if (existsSync(path)) chmodPrivateActivityFile(path);
    }
  }

  constructor(file: string, options: { now?: () => number; maxSourceEvents?: number; maxDatabaseBytes?: number; readOnly?: boolean;projectDeliverySource?:ProjectDeliveryStoreSource;projectOrdinarySource?:ProjectOrdinaryStoreSource } = {}) {
    this.projectDeliverySource=options.projectDeliverySource;
    this.projectOrdinarySource=options.projectOrdinarySource;
    this.readOnly = options.readOnly ?? false;
    this.now = options.now ?? Date.now;
    this.maxSourceEvents = options.maxSourceEvents ?? 100_000;
    if (!Number.isSafeInteger(this.maxSourceEvents) || this.maxSourceEvents < 1) throw new Error('invalid_activity_capacity');
    const maximumBytes = options.maxDatabaseBytes ?? 256 * 1024 * 1024;
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1024 * 1024) throw new Error('invalid_activity_capacity');
    if (!this.readOnly) createPrivateActivityDirectory(dirname(file));
    file = existsSync(file) ? realpathSync(file) : join(realpathSync(dirname(resolve(file))), basename(file));
    this.file = file;
    if (this.readOnly) {
      // SQLite may create missing WAL sidecars even for a read-only connection.
      // Live WAL reads require both existing sidecars. Offline reads use immutable
      // URI mode where supported, or an owner-locked private snapshot on old Node.
      const hasWal = existsSync(`${file}-wal`);
      if (hasWal && !existsSync(`${file}-shm`)) throw new Error('conversation_activity_readonly_sidecars_missing');
      if (!hasWal && activityReadonlyNeedsSnapshot) {
        this.readonlySnapshot = createActivityReadonlySnapshot(file, maximumBytes, retainedActivityStoreConstructions,
          () => recordActivityStoreCleanupFailure('readonly-close', 'readonly-cleanup'));
        this.db = this.readonlySnapshot.db;
      } else this.db = new DatabaseSync(hasWal ? file : `${pathToFileURL(file).href}?immutable=1`, { readOnly: true });
      try {
        const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (![4,5].includes(version)) throw new Error('conversation_activity_schema_unsupported');
      } catch (error) {
        if (this.readonlySnapshot) {
          try { this.readonlySnapshot.close(); }
          catch { recordActivityStoreCleanupFailure('readonly-close', 'constructor-cleanup'); }
        } else closeFailedActivityStoreConstruction(this.db, undefined, 'readonly-close');
        throw error;
      }
      return;
    }
    try {
      for (const target of [file, `${file}.owner.sqlite`]) {
        if (!existsSync(target)) closeSync(openSync(target, 'a', 0o600));
        if (process.platform !== 'win32') chmodSync(target, 0o600);
      }
    } catch { throw new Error('activity_storage_not_private'); }
    this.owner = new DatabaseSync(`${file}.owner.sqlite`);
    try {
      // A separate rollback-journal database supplies an OS-managed exclusive lock.
      // It is held for this owner's lifetime and released by process exit, never mtime.
      // Fresh concurrent connections may briefly hold initialization read locks.
      // Wait only while acquiring the same exclusive transaction; never retry RPCs.
      this.owner.exec('PRAGMA busy_timeout=100; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
      this.owner.exec('PRAGMA busy_timeout=0');
      this.secureSidecars();
    } catch (error) {
      // Preserve the existing public owner-held mapping and retain its real cause.
      const primary = new Error('conversation_activity_owner_held', { cause: error });
      closeFailedActivityStoreConstruction(undefined, this.owner);
      throw primary;
    }
    let opened: DatabaseSync | undefined;
    try {
      this.db = opened = new DatabaseSync(file);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
      try {
        if (process.platform !== 'win32') for (const suffix of ['', '-wal', '-shm']) if (existsSync(file + suffix)) chmodSync(file + suffix, 0o600);
      } catch { throw new Error('activity_storage_not_private'); }
      const pageSize = (this.db.prepare('PRAGMA page_size').get() as { page_size: number }).page_size;
      this.db.exec(`PRAGMA max_page_count=${Math.floor(maximumBytes / pageSize)}`);
      const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
      if (version.user_version > 5) throw new Error('conversation_activity_schema_unsupported');
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS association_operations(operation_id TEXT PRIMARY KEY, creation_key TEXT NOT NULL UNIQUE, data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS work_watches(watch_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES association_operations(operation_id), profile_id TEXT NOT NULL, thread_id TEXT NOT NULL, data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS work_bindings(watch_id TEXT PRIMARY KEY REFERENCES work_watches(watch_id), data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS work_projections(watch_id TEXT PRIMARY KEY REFERENCES work_watches(watch_id), data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS source_events(event_key TEXT PRIMARY KEY, watch_id TEXT NOT NULL REFERENCES work_watches(watch_id), content_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS source_event_watch ON source_events(watch_id);
        CREATE TABLE IF NOT EXISTS source_event_retention(event_key TEXT PRIMARY KEY REFERENCES source_events(event_key) ON DELETE CASCADE, received_at INTEGER NOT NULL,kind TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS watch_event_receipts(watch_id TEXT NOT NULL REFERENCES work_watches(watch_id),event_key TEXT NOT NULL,PRIMARY KEY(watch_id,event_key));
        CREATE TABLE IF NOT EXISTS source_cursors(watch_id TEXT PRIMARY KEY REFERENCES work_watches(watch_id), sequence INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS conversation_activities(local_seq INTEGER PRIMARY KEY AUTOINCREMENT, activity_id TEXT NOT NULL UNIQUE, watch_id TEXT NOT NULL REFERENCES work_watches(watch_id), profile_id TEXT NOT NULL, thread_id TEXT NOT NULL, data_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS activity_thread_page ON conversation_activities(profile_id,thread_id,local_seq);
        CREATE TABLE IF NOT EXISTS quarantined_events(event_key TEXT PRIMARY KEY, watch_id TEXT NOT NULL, error_code TEXT NOT NULL, source_sequence INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS conversation_reads(profile_id TEXT NOT NULL,thread_id TEXT NOT NULL,sequence INTEGER NOT NULL,PRIMARY KEY(profile_id,thread_id));
        CREATE TABLE IF NOT EXISTS thread_tombstones(profile_id TEXT NOT NULL,thread_id TEXT NOT NULL,operation_id TEXT NOT NULL,PRIMARY KEY(profile_id,thread_id));
        CREATE TABLE IF NOT EXISTS notification_attempts(activity_id TEXT PRIMARY KEY,status TEXT NOT NULL,attempted_at INTEGER);
        CREATE TABLE IF NOT EXISTS model_wakes(wake_id TEXT PRIMARY KEY,watch_id TEXT NOT NULL,permission_revision INTEGER NOT NULL,status TEXT NOT NULL,data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS mcp_task_references(watch_id TEXT PRIMARY KEY REFERENCES work_watches(watch_id),data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS activity_presentations(profile_id TEXT NOT NULL,thread_id TEXT NOT NULL,medium TEXT NOT NULL,sequence INTEGER NOT NULL,PRIMARY KEY(profile_id,thread_id,medium));
        ${ATTENTION_PRESENTATION_SQL}
        ${ORDINARY_ATTENTION_FACT_SQL}
        ${ATTENTION_CANONICAL_SQL}
        ${NATIVE_ATTENTION_SOURCE_SQL}
        ${PROJECT_DELIVERY_FACT_SQL}
        PRAGMA user_version=${version.user_version===5?5:4};
        COMMIT;
      `);
      migrateAssistantDigestReceipts(this.db);
      this.db.prepare(`INSERT OR IGNORE INTO source_event_retention SELECT event_key,COALESCE(json_extract(content_json,'$.occurredAt'),?),json_extract(content_json,'$.kind') FROM source_events`).run(this.now());
      this.secureSidecars();
    } catch (error) {
      closeFailedActivityStoreConstruction(opened, this.owner);
      throw error;
    }
  }

  getAssistantDigestReceipt(deliveryId:string){return getAssistantDigestReceipt(this.db,deliveryId);}
  claimAssistantDigest(input:Parameters<typeof claimAssistantDigest>[1]){return this.transaction(()=>claimAssistantDigest(this.db,input));}
  finishAssistantDigest(input:Parameters<typeof finishAssistantDigest>[1]){return this.transaction(()=>finishAssistantDigest(this.db,input));}

  private transaction<T>(fn: () => T,beforeCommit?:()=>void): T {
    if (this.readOnly) throw new Error('conversation_activity_readonly');
    if (this.closed) throw new Error('conversation_activity_store_closed');
    if (this.writeState !== 'writable') throw new Error('conversation_activity_write_unconfirmed');
    try { this.db.exec('BEGIN IMMEDIATE'); }
    catch (primary) {
      // Only the thrown call is known. Do not infer BEGIN opened a transaction,
      // or issue ROLLBACK against a transaction whose ownership is unconfirmed.
      this.writeState = 'unconfirmed';
      recordActivityStoreCleanupFailure('begin', 'begin-threw', 'primary-state-unknown');
      throw primary;
    }
    let result!: T;
    let stage: ActivityStoreCleanupDiagnostic['stage'] = 'body-failed';
    try {
      result = fn();
      assertBeforeEffects(beforeCommit);
      if(beforeCommit&&this.writeState!=='writable')throw Error('conversation_activity_write_unconfirmed');
      stage = 'commit-threw'; // COMMIT may throw; do not infer whether it committed.
      this.db.exec('COMMIT');
    } catch (primary) {
      if (stage === 'commit-threw') {
        this.writeState = 'unconfirmed';
        recordActivityStoreCleanupFailure('commit', stage, 'primary-state-unknown');
      }
      try { this.db.exec('ROLLBACK'); }
      catch {
        this.writeState = 'unconfirmed'; // Before logging/reentrant diagnostics.
        recordActivityStoreCleanupFailure('rollback', stage);
      }
      try { this.secureSidecars(); }
      catch {
        this.writeState = 'unconfirmed';
        recordActivityStoreCleanupFailure('secure-sidecars', stage);
      }
      throw primary; // Exact original identity, including a non-Error thrown value.
    }
    // COMMIT returned. Cleanup failures must not enter the rollback catch above.
    try { this.secureSidecars(); }
    catch (primary) {
      this.writeState = 'committed-unverified';
      recordActivityStoreCleanupFailure('secure-sidecars', 'commit-returned', 'primary-after-commit');
      throw primary;
    }
    return result;
  }

  prepareAssociation(input: { operationId: string; creationIdempotencyKey: string; origin: ActivityOrigin }): void {
    if (![input.operationId, input.creationIdempotencyKey, ...Object.values(input.origin)].every(id)) throw new Error('invalid_activity_association');
    this.transaction(() => {
      if (this.deleted(input.origin.profileId, input.origin.threadId)) throw new Error('activity_thread_deleted');
      const existing = this.getAssociation(input.operationId);
      if (existing) {
        if (encode(canonical(existing)) !== encode(canonical(input))) throw new Error('activity_association_conflict');
        return;
      }
      this.db.prepare('INSERT INTO association_operations VALUES(?,?,?)').run(input.operationId, input.creationIdempotencyKey, encode(input));
    });
  }

  getAssociation(operationId: string): { operationId: string; creationIdempotencyKey: string; origin: ActivityOrigin } | null {
    const row = this.db.prepare('SELECT data_json FROM association_operations WHERE operation_id=?').get(operationId) as { data_json: string } | undefined;
    return row ? JSON.parse(row.data_json) : null;
  }
  forgetUnboundAssociation(operationId: string): void {
    this.transaction(() => this.db.prepare('DELETE FROM association_operations WHERE operation_id=? AND NOT EXISTS(SELECT 1 FROM work_watches WHERE operation_id=?)').run(operationId, operationId));
  }
  getPresentationCursor(profileId: string, threadId: string, medium: string): number {
    return (this.db.prepare('SELECT sequence FROM activity_presentations WHERE profile_id=? AND thread_id=? AND medium=?').get(profileId, threadId, medium) as { sequence: number } | undefined)?.sequence ?? 0;
  }
  markPresented(profileId: string, threadId: string, medium: string, through: number): void {
    if (!Number.isSafeInteger(through) || through < 0 || !id(medium)) throw new Error('invalid_activity_presentation_cursor');
    this.transaction(() => this.db.prepare('INSERT INTO activity_presentations VALUES(?,?,?,?) ON CONFLICT(profile_id,thread_id,medium) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)').run(profileId, threadId, medium, through));
  }

  bindWork(binding: WorkBinding, mcpReference?: SerializedTaskReference): WorkWatch {
    return this.transaction(() => {
      const operation = this.getAssociation(binding.operationId);
      if (!operation) throw new Error('activity_association_missing');
      if (this.deleted(operation.origin.profileId, operation.origin.threadId)) throw new Error('activity_thread_deleted');
      if (![binding.watchId, binding.workId, binding.logicalSourceId, binding.sourceDataEpoch].every(id)) throw new Error('invalid_work_binding');
      const existing = this.getWatch(binding.watchId);
      if (existing) {
        for (const key of ['operationId', 'source', 'logicalSourceId', 'sourceDataEpoch', 'workId', 'runId'] as const) {
          if ((existing[key] ?? '') !== (binding[key] ?? '')) throw new Error('activity_binding_conflict');
        }
        if (mcpReference && encode(this.getMcpReference(binding.watchId)) !== encode(mcpReference)) throw new Error('activity_mcp_reference_conflict');
        return existing;
      }
      const watch: WorkWatch = { ...binding, runId: binding.runId ?? '', origin: operation.origin, status: 'active',
        generation: 0, preference: 'normal', policyRevision: 0, nextReportDueAt: this.now() + REPORT_INTERVAL };
      this.db.prepare('INSERT INTO work_watches VALUES(?,?,?,?,?)').run(watch.watchId, watch.operationId, watch.origin.profileId, watch.origin.threadId, encode(watch));
      this.db.prepare('INSERT INTO work_bindings VALUES(?,?)').run(watch.watchId, encode(binding));
      if (mcpReference) {
        if (binding.source !== 'mcp' || mcpReference.endpointId !== binding.logicalSourceId || mcpReference.taskId !== binding.workId
          || !['v1', 'v2'].includes(mcpReference.generation) || mcpReference.originalOperation !== 'tools/call') throw new Error('invalid_activity_mcp_reference');
        this.db.prepare('INSERT INTO mcp_task_references VALUES(?,?)').run(watch.watchId, encode(mcpReference));
      }
      const projection: WorkProjection = { watchId: watch.watchId, executionState: 'accepted', businessOutcome: 'unknown',
        freshness: 'fresh', sourceSequence: 0, revision: 0, lastProgressAt: null, lastHeartbeatAt: null, lastReportAt: null, evidenceRefs: [] };
      this.saveProjection(projection,{kind:'bind',id:digest([watch.operationId,watch.sourceDataEpoch]),core:{executionState:'accepted',businessOutcome:'unknown'}});
      this.addActivity(watch, projection, 'accepted', `created:${watch.watchId}`);
      return watch;
    });
  }

  getWatch(watchId: string): WorkWatch | null {
    const row = this.db.prepare('SELECT data_json FROM work_watches WHERE watch_id=?').get(watchId) as { data_json: string } | undefined;
    return row ? JSON.parse(row.data_json) : null;
  }
  getMcpReference(watchId: string): SerializedTaskReference | null {
    const row = this.db.prepare('SELECT data_json FROM mcp_task_references WHERE watch_id=?').get(watchId) as { data_json: string } | undefined;
    return row ? JSON.parse(row.data_json) : null;
  }
  getNativeAttentionEnrollment(watchId:string):NativeAttentionEnrollment|null {
    const watch=this.getWatch(watchId);if(!watch)throw Error('activity_watch_not_found');return readNativeAttentionEnrollment(this.db,watch);
  }
  /** Original DB receipt read; a caller's terminal declaration is never used. */
  readNativeTerminalAttentionInventory(watchId:string){
    const watch=this.getWatch(watchId),projection=this.getProjection(watchId);
    if(!watch||!projection)throw Error('activity_watch_not_found');
    return nativeTerminalInventoryLocked(this.db,watch,projection);
  }
  enrollNativeAttentionSource(watchId:string,reference:unknown):{enrollment:NativeAttentionEnrollment;delivery:NativeActivitySourceDelivery} {
    const enrollment=this.transaction(()=>{
      const watch=this.getWatch(watchId);if(!watch)throw Error('activity_watch_not_found');
      if(this.deleted(watch.origin.profileId,watch.origin.threadId))throw Error('activity_thread_deleted');
      return enrollNativeAttentionSourceLocked(this.db,watch,reference);
    });
    const delivery=Object.freeze({watchId,enrollmentIncarnation:enrollment.enrollmentIncarnation});this.nativeDeliveries.set(delivery,enrollment);return {enrollment,delivery};
  }
  revokeNativeAttentionDelivery(delivery:NativeActivitySourceDelivery):void {this.nativeDeliveries.delete(delivery);}
  private assertNativeSourceWriter(watchId:string,delivery?:ActivitySourceDelivery):void {
    const current=this.getNativeAttentionEnrollment(watchId);if(!current)return;
    const issued=delivery&&this.nativeDeliveries.get(delivery as NativeActivitySourceDelivery);
    if(!issued||issued.watchId!==watchId||issued.enrollmentIncarnation!==current.enrollmentIncarnation||issued.bindingDigest!==current.bindingDigest)throw Error('activity_native_source_delivery_required');
  }
  private assertProjectSourceWriter(watchId:string,delivery?:ActivitySourceDelivery,negative=false):void{
    const watch=this.getWatch(watchId);if(!watch||watch.source!=='kswarm')return;
    const projection=this.getProjection(watchId);if(!projection)throw Error('activity_source_unavailable');
    if(negative)return;
    if(!this.projectOrdinarySource&&!hasProjectDeliveryLineage(this.db,projectActivityAttention(watch,projection).anchorFactId))return;
    const source=delivery&&this.projectWrites.get(delivery as ProjectOrdinaryWriteCapability);
    if(!source||source.watchId!==watchId||source.identity!==digest(watch))throw Error('activity_project_source_delivery_required');
    assertBeforeEffects(()=>source.assertCurrent());
    const current=this.getWatch(watchId);
    if(!current||source.identity!==digest(current)||this.closed)throw Error('activity_project_source_delivery_required');
    if(this.writeState!=='writable')throw Error('conversation_activity_write_unconfirmed');
  }

  listWatches(): WorkWatch[] {
    return (this.db.prepare('SELECT data_json FROM work_watches').all() as Array<{ data_json: string }>).map(row => JSON.parse(row.data_json));
  }

  getProjection(watchId: string): WorkProjection | null {
    const row = this.db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(watchId) as { data_json: string } | undefined;
    return row ? JSON.parse(row.data_json) : null;
  }
  private attentionPresentations(){
    if(this.closed)throw Error('conversation_activity_store_closed');
    return this.attentionMetadata??=createAttentionPresentationStore(this.db,action=>this.transaction(action));
  }
  getAttentionSourceSnapshot(watchId:string){return this.attentionPresentations().sourceSnapshot(watchId);}
  captureAttentionRead(watchId:string){return this.attentionPresentations().captureRead(watchId);}
  finalizeAttentionReadRound(watchId:string,input:AttentionReadFinalization){return this.attentionPresentations().finalizeRead(watchId,input);}
  getAttentionPresentation(watchId:string){return this.attentionPresentations().read(watchId);}
  rebuildAttentionPresentation(watchId:string,input:AttentionPresentationRebuild){return this.attentionPresentations().rebuild(watchId,input);}
  dismissAttentionPresentation(watchId:string,version:number,incarnation:string){return this.attentionPresentations().dismiss(watchId,version,incarnation);}
  clearAttentionPresentationBody(watchId:string,incarnation:string){return this.attentionPresentations().clearBody(watchId,incarnation);}

  private projectDeliveryFacts(){
    if(this.closed)throw Error('conversation_activity_store_closed');
    // Only invoked inside this Store's transaction. The original query uses
    // this same connection without opening another BEGIN.
    const locked=createAttentionPresentationStore(this.db,action=>action());
    return this.projectDeliveryMetadata??=createProjectDeliveryFacts(this.db,watchId=>locked.captureRead(watchId));
  }
  private projectDeliveryFrame(frame:object){
    if(this.closed)throw Error('conversation_activity_store_closed');
    if(!this.projectDeliverySource)throw Error('project_delivery_source_unsupported');
    const source=this.projectDeliverySource(frame);
    const check=source.assertCurrent;
    const assertCurrent=()=>{
      assertBeforeEffects(()=>check.call(source));
      if(this.closed)throw Error('conversation_activity_store_closed');
      if(this.writeState!=='writable')throw Error('conversation_activity_write_unconfirmed');
    };
    assertCurrent();
    const watchId=source.watchId,after=source.after,demandId=source.demandId,watch=this.getWatch(watchId);
    if(!watch||watch.source!=='kswarm')throw Error('project_delivery_source_unverified');
    // Descriptor-safe capture creates private bytes before any further guard.
    // Mutating the original frame/body cannot replace this invocation's data.
    const body=parseScopedProjectActivityPage(source.body,{projectId:watch.workId,sourceDataEpoch:watch.sourceDataEpoch,after,profileId:watch.origin.profileId,workspaceId:watch.origin.workspaceId});
    return Object.freeze({watchId,after,demandId,body,assertCurrent});
  }
  acceptProjectDelivery(frame:object):void{
    const source=this.projectDeliveryFrame(frame);
    this.transaction(()=>{source.assertCurrent();this.projectDeliveryFacts().accept(source.watchId,source.body,source.after,source.demandId);source.assertCurrent();});
    // A rejection here does not undo an already committed transaction.
    source.assertCurrent();
  }
  readProjectDelivery(frame:object){
    const source=this.projectDeliveryFrame(frame);
    const result=this.transaction(()=>{source.assertCurrent();const value=this.readProjectDeliveryLocked(source);source.assertCurrent();return value;});
    source.assertCurrent();return result;
  }
  private readProjectDeliveryLocked(source:{watchId:string;demandId:string;body:ReturnType<typeof parseScopedProjectActivityPage>}){
    if(source.body.page.delivery.status!=='current')throw Error('project_delivery_source_unverified');
    const value=this.projectDeliveryFacts().read(source.watchId,source.demandId);
    if(value&&(value.bindingDigest!==source.body.bindingDigest||JSON.stringify(value.head)!==JSON.stringify(source.body.page.delivery.head)))throw Error('project_delivery_source_conflict');
    return value;
  }
  finalizeProjectDelivery(frame:object,input:ProjectAttentionFinalization){
    const source=this.projectDeliveryFrame(frame);
    const result=this.transaction(()=>{
      source.assertCurrent();if(!this.readProjectDeliveryLocked(source))throw Error('project_delivery_source_unverified');
      const locked=createAttentionPresentationStore(this.db,action=>action());
      const value=locked.finalizeProjectRead(source.watchId,{...input,demandId:source.demandId});source.assertCurrent();return value;
    });
    this.projectDeliveryReads.set(result,Object.freeze({frame,membershipDigest:result.membershipDigest,witnessDigest:result.witnessDigest,presentationIncarnation:result.presentationIncarnation,projectionVersion:result.projectionVersion,dismissed:result.dismissed,
      viewDigest:projectForwardDigest({...result.view,attentionState:{presentationIncarnation:result.presentationIncarnation,dismissed:result.dismissed}})}));
    this.assertProjectDeliveryRead(frame,result);return result;
  }
  /** Checks the original result receipt and complete CURRENT database set.
   * This is a public-return guard, never invoked from a Store transaction. */
  assertProjectDeliveryRead(frame:object,result:object):void{
    const expected=this.projectDeliveryReads.get(result);
    if(!expected||expected.frame!==frame)throw Error('project_delivery_read_foreign');
    const source=this.projectDeliveryFrame(frame);
    this.transaction(()=>{
      source.assertCurrent();const delivery=this.readProjectDeliveryLocked(source),locked=createAttentionPresentationStore(this.db,action=>action());
      const captured=locked.captureRead(source.watchId),presentation=locked.read(source.watchId);
      if(!delivery||delivery.membershipDigest!==expected.membershipDigest||delivery.witnessDigest!==expected.witnessDigest||captured.membershipDigest!==expected.membershipDigest
        ||!presentation||presentation.presentationIncarnation!==expected.presentationIncarnation||presentation.projectionVersion!==expected.projectionVersion||presentation.dismissed!==expected.dismissed)throw Error('project_delivery_read_conflict');
      source.assertCurrent();
    });
    source.assertCurrent();
  }
  /** A synchronous SELECT-only snapshot on this original connection. Never
   * runs the writer transaction, migrations, finalizer or witness repair. */
  private assertProjectSnapshotCurrent():void{
    if(this.closed)throw Error('conversation_activity_store_closed');
    if(this.projectSnapshotUnconfirmed||!this.readOnly&&this.writeState!=='writable')throw Error('conversation_activity_read_unconfirmed');
  }
  private projectReadSnapshot<T>(action:()=>T):T{
    this.assertProjectSnapshotCurrent();
    try{this.db.exec('BEGIN');}catch(error){this.projectSnapshotUnconfirmed=true;throw error;}
    let committing=false,committed=false;
    try{const value=action();this.assertProjectSnapshotCurrent();committing=true;this.db.exec('COMMIT');committed=true;this.assertProjectSnapshotCurrent();return value;}
    catch(primary){
      if(committing&&!committed)this.projectSnapshotUnconfirmed=true;
      if(!committed)try{this.db.exec('ROLLBACK');}catch{this.projectSnapshotUnconfirmed=true;}
      throw primary;
    }
  }
  private projectForwardSnapshotLocked(watchId:string,demandId:string){
    const locked=createAttentionPresentationStore(this.db,action=>action()),captured=locked.captureRead(watchId);
    if(captured.watch.source!=='kswarm'||captured.watch.status!=='active')throw Error('project_delivery_source_unverified');
    const delivery=this.projectDeliveryFacts().read(watchId,demandId),presentation=locked.read(watchId),head=locked.readHead(watchId);
    if(!delivery||!presentation?.presentation||!head)throw Error('project_delivery_source_unverified');
    const view={watch:captured.watch,projection:captured.projection,presentation:presentation.presentation,
      attentionState:{presentationIncarnation:presentation.presentationIncarnation,dismissed:presentation.dismissed}};
    return{stamp:parseProjectForwardStamp({protocol:1,watchId,demandId,stateDigest:projectForwardDigest([captured,delivery,presentation,head]),viewDigest:projectForwardDigest(view)}),view,members:captured.members};
  }
  /** Export data only from an actual finalizer receipt and its original demand. */
  captureProjectForwardStamp(frame:object,result:object):ProjectForwardStamp{
    this.assertProjectDeliveryRead(frame,result);
    const source=this.projectDeliveryFrame(frame),expected=this.projectDeliveryReads.get(result)!;
    const snapshot=this.projectReadSnapshot(()=>{source.assertCurrent();const snapshot=this.projectForwardSnapshotLocked(source.watchId,source.demandId);
      if(snapshot.view.attentionState.presentationIncarnation!==expected.presentationIncarnation||snapshot.view.presentation.projectionVersion!==expected.projectionVersion
        ||snapshot.view.attentionState.dismissed!==expected.dismissed||snapshot.stamp.viewDigest!==expected.viewDigest)throw Error('project_delivery_read_conflict');source.assertCurrent();return snapshot;});
    this.assertProjectDeliveryRead(frame,result);this.assertProjectSnapshotCurrent();return snapshot.stamp;
  }
  /** Read-only data consistency check. The caller must separately require an
   * original authenticated transport receipt and current user permissions. */
  assertProjectForwardSnapshot(raw:unknown,view:unknown){
    const stamp=parseProjectForwardStamp(raw),viewDigest=projectForwardDigest(view);
    return this.projectReadSnapshot(()=>{
      const snapshot=this.projectForwardSnapshotLocked(stamp.watchId,stamp.demandId),current=snapshot.stamp;
      if(current.stateDigest!==stamp.stateDigest||current.viewDigest!==stamp.viewDigest||viewDigest!==stamp.viewDigest)throw Error('project_delivery_read_conflict');
      return snapshot.members;
    });
  }
  invalidateProjectDelivery(watchId:string):void{
    this.transaction(()=>this.projectDeliveryFacts().invalidate(watchId));
  }

  /** Ordinary events use an independently authenticated source frame. The
   * temporary write capability never leaves this synchronous invocation. */
  applyProjectSourcePage(frame:object):void{
    if(!this.projectOrdinarySource)throw Error('project_ordinary_source_unsupported');
    const source=this.projectOrdinarySource(frame),check=source.assertCurrent;
    const assertCurrent=()=>{
      assertBeforeEffects(()=>check.call(source));
      if(this.closed)throw Error('conversation_activity_store_closed');
      if(this.writeState!=='writable')throw Error('conversation_activity_write_unconfirmed');
    };
    assertCurrent();const watchId=source.watchId,after=source.after,watch=this.getWatch(watchId);
    if(!watch||watch.source!=='kswarm'||watch.status!=='active'||this.deleted(watch.origin.profileId,watch.origin.threadId))throw Error('activity_project_source_delivery_required');
    const page=parseProjectActivityPage(source.page,{projectId:watch.workId,sourceDataEpoch:watch.sourceDataEpoch,after});
    page.delivery={status:'unavailable',reasonCode:'SNAPSHOT_INCOMPLETE'};
    const retained={sourceDataEpoch:page.sourceDataEpoch,coveredThrough:page.coveredThrough,gapRanges:page.gapRanges,
      events:page.events.map(event=>({...event,logicalSourceId:watch.logicalSourceId,transportGeneration:watch.generation,receivedAt:this.now()}))};
    const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}};
    freeze(page);freeze(retained);
    const capability=Object.freeze({kind:'project_ordinary_write_v1' as const}),record={watchId,identity:digest(watch),assertCurrent,page,after,step:'retained' as 'retained'|'snapshot'|'fresh',retained,snapshot:undefined as{epoch:string;sequence:number;state:WorkProjection['executionState']}|undefined};
    this.projectWrites.set(capability,record);
    try{
      this.transaction(()=>{this.assertProjectSourceWriter(watchId,capability);this.projectDeliveryFacts().invalidate(watchId);},()=>this.assertProjectSourceWriter(watchId,capability));
      this.ingestRetainedPage(watchId,retained,capability);
      if(page.nextCursor===page.headSeq&&(['closed','delivered'].includes(page.snapshot.status)||page.snapshot.deliveredAt!==null)){
        const state=page.snapshot.status==='closed'&&page.snapshot.deliveredAt===null?'cancelled' as const:'completed' as const;
        record.step='snapshot';record.snapshot={epoch:page.sourceDataEpoch,sequence:page.headSeq,state};
        this.reconcileSnapshot(watchId,page.sourceDataEpoch,page.headSeq,state,false,capability);
      }
      record.step='fresh';this.setFreshness(watchId,'fresh',undefined,capability);assertCurrent();
    }finally{this.projectWrites.delete(capability);}
  }

  getOrdinaryAttentionFact(watchId:string){return this.transaction(()=>{
    const watch=this.getWatch(watchId);if(!watch)throw Error('activity_watch_not_found');
    if(this.deleted(watch.origin.profileId,watch.origin.threadId))throw Error('activity_thread_deleted');
    const row=this.db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(watchId) as {data_json:string}|undefined;
    if(!row)throw Error('attention_source_unverified');return createOrdinaryAttentionFacts(this.db).read(watch,row.data_json);
  });}

  private saveProjection(projection: WorkProjection,witness?:OrdinaryStateWitness|false): void {
    const watch=this.getWatch(projection.watchId);if(!watch)throw Error('activity_watch_not_found');
    saveActivityProjectionLocked(this.db,watch,projection,witness);
  }

  private saveWatch(watch: WorkWatch): void {
    this.db.prepare('UPDATE work_watches SET data_json=? WHERE watch_id=?').run(encode(watch), watch.watchId);
  }

  private addActivity(watch: WorkWatch, projection: WorkProjection, kind: ConversationActivity['kind'], activityId: string): void {
    const data = { activityId, watchId: watch.watchId, threadId: watch.origin.threadId, kind, at: this.now(), projection };
    if (kind === 'progress') {
      const prior = this.db.prepare('SELECT 1 FROM conversation_activities WHERE activity_id=?').get(activityId);
      if (prior) {
        this.db.prepare('UPDATE conversation_activities SET local_seq=(SELECT COALESCE(MAX(local_seq),0)+1 FROM conversation_activities),data_json=? WHERE activity_id=?').run(encode(data), activityId);
        return;
      }
    }
    this.db.prepare('INSERT OR IGNORE INTO conversation_activities(activity_id,watch_id,profile_id,thread_id,data_json) VALUES(?,?,?,?,?)')
      .run(activityId, watch.watchId, watch.origin.profileId, watch.origin.threadId, encode(data));
  }

  private refreshCard(watch: WorkWatch, projection: WorkProjection): void {
    refreshActivityCardLocked(this.db,watch,projection);
  }

  ingest(watchId: string, raw: unknown,delivery?:ActivitySourceDelivery): { acknowledge: boolean; duplicate?: boolean; quarantined?: boolean } {
    if(delivery&&this.projectWrites.has(delivery as ProjectOrdinaryWriteCapability))throw Error('activity_project_source_delivery_required');
    const result=this.transaction(() => this.ingestLocked(watchId, raw,delivery),()=>this.assertProjectSourceWriter(watchId,delivery));
    // A verified source gap is a committed restrictive observation, not an
    // accepted Host event. Return its original semantic rejection after commit.
    if(result.gapFailure)throw result.gapFailure;
    return result;
  }

  private ingestLocked(watchId: string, raw: unknown,delivery?:ActivitySourceDelivery): { acknowledge: boolean; duplicate?: boolean; quarantined?: boolean;gapFailure?:Error } {
      this.assertNativeSourceWriter(watchId,delivery);
      this.assertProjectSourceWriter(watchId,delivery);
      const watch = this.getWatch(watchId);
      if (!watch) throw new Error('activity_watch_not_found');
      if (watch.status === 'stopped' || this.deleted(watch.origin.profileId, watch.origin.threadId)) return { acknowledge: true };
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('activity_event_identity_missing');
      const event = raw as WorkEvent;
      if (!id(event.eventId)) throw new Error('activity_event_identity_missing');
      for (const field of ['source', 'logicalSourceId', 'sourceDataEpoch', 'workId', 'runId'] as const) {
        if ((event[field] ?? '') !== (watch[field] ?? '')) throw new Error('activity_source_mismatch');
      }
      const eventKey = digest([event.source, event.logicalSourceId, event.sourceDataEpoch, event.workId, event.runId ?? '', event.eventId]);
      if (this.db.prepare('SELECT 1 FROM quarantined_events WHERE event_key=?').get(`${watchId}:${eventKey}`)) return { acknowledge: true, quarantined: true, duplicate: true };
      const { receivedAt: _received, transportGeneration: _generation, ...stable } = event;
      const content = encode(canonical(stable));
      const prior = this.db.prepare('SELECT content_json FROM source_events WHERE event_key=?').get(eventKey) as { content_json: string } | undefined;
      if (prior) {
        if (prior.content_json !== content) throw new Error('activity_event_conflict');
        if (this.db.prepare('SELECT 1 FROM watch_event_receipts WHERE watch_id=? AND event_key=?').get(watchId, eventKey)) return { acknowledge: true, duplicate: true };
      }
      const projection = this.getProjection(watchId)!;
      const native=this.getNativeAttentionEnrollment(watchId);
      const sequence = event.sourceSequence ?? projection.sourceSequence + 1;
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('invalid_activity_sequence');
      if (event.sourceSequence !== undefined && sequence > projection.sourceSequence + 1) {
        if(native){markNativeAttentionCoverageUnknownLocked(this.db,watch,'gap',[watch.sourceDataEpoch,projection.sourceSequence+1,sequence-1,eventKey]);return {acknowledge:false,quarantined:true,gapFailure:new Error('activity_source_gap')};}
        throw new Error('activity_source_gap');
      }
      // A compacted native sequence is already covered by the durable cursor.
      // Never reinterpret it as a new fact after retention removed its detail.
      if (!prior && event.sourceSequence !== undefined && sequence <= projection.sourceSequence) return { acknowledge: true, duplicate: true };
      const owner=event.schemaVersion===2?nativeApprovalOwnerSchema.safeParse(event.questionOwner):undefined;
      if(native&&owner?.success&&!nativeApprovalOwnerMatchesReference(owner.data,native.reference))throw Error('activity_native_source_owner_conflict');
      const validSchema=event.schemaVersion===1&&!Object.hasOwn(event,'questionId')&&!Object.hasOwn(event,'questionOwner')
        ||event.schemaVersion===2&&event.source==='task_host'&&event.kind==='input_required'&&owner?.success&&owner.data.approvalToken===event.questionId&&owner.data.taskSessionId===event.sourceDataEpoch
          &&Object.keys(event).every(key=>['schemaVersion','eventId','source','logicalSourceId','sourceDataEpoch','transportGeneration','workId','runId','sourceSequence','sourceRevision','kind','occurredAt','receivedAt','businessOutcome','summary','evidenceRefs','executionStarted','questionId','questionOwner'].includes(key));
      const valid = validSchema && KINDS.has(event.kind) && (event.occurredAt === undefined || Number.isSafeInteger(event.occurredAt) && event.occurredAt >= 0)
        && Array.isArray(event.evidenceRefs) && event.evidenceRefs.length <= 64 && event.evidenceRefs.every(id)
        && (event.businessOutcome === undefined || ['unknown','success','error','cancelled'].includes(event.businessOutcome))
        && Number.isSafeInteger(event.receivedAt) && event.receivedAt >= 0
        && (event.summary === undefined || typeof event.summary === 'string') && Buffer.byteLength(content) <= 16 * 1024;
      if (!valid) {
        if(native)markNativeAttentionCoverageUnknownLocked(this.db,watch,'schema_invalid',[eventKey,sequence]);
        this.db.prepare('INSERT OR IGNORE INTO quarantined_events VALUES(?,?,?,?)').run(`${watchId}:${eventKey}`, watchId, 'activity_schema_invalid', sequence);
        projection.sourceSequence = Math.max(projection.sourceSequence, sequence);
        projection.freshness = 'stale'; projection.errorCode = 'activity_schema_invalid'; projection.revision++;
        this.addActivity(watch, projection, 'diagnostic', `quarantine:${eventKey}`);
        this.saveProjection(projection,false);
        this.refreshCard(watch, projection);
        this.db.prepare('INSERT INTO source_cursors VALUES(?,?) ON CONFLICT(watch_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)').run(watchId, sequence);
        return { acknowledge: true, quarantined: true };
      }
      const preserveNativeBlock=Boolean(native&&owner?.success&&event.schemaVersion===2&&event.kind==='input_required'&&projection.executionState==='blocked');
      if(preserveNativeBlock){
        const prior=this.db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(watchId) as {data_json:string};
        if(createOrdinaryAttentionFacts(this.db).read(watch,prior.data_json).executionState!=='blocked')throw Error('attention_source_unverified');
      }
      if (!prior) {
        this.compactSourceProgress(watchId, event.kind === 'progress' || event.kind === 'heartbeat' ? 255 : 256);
        const total = (this.db.prepare('SELECT COUNT(*) AS count FROM source_events').get() as { count: number }).count;
        if (total >= this.maxSourceEvents) throw new Error('activity_capacity_exceeded');
        this.db.prepare('INSERT INTO source_events VALUES(?,?,?)').run(eventKey, watchId, content);
        this.db.prepare('INSERT INTO source_event_retention VALUES(?,?,?)').run(eventKey, this.now(), event.kind);
      }
      this.db.prepare('INSERT INTO watch_event_receipts VALUES(?,?)').run(watchId, eventKey);
      const nativeOwnershipLost=Boolean(native&&event.kind==='input_required'&&!(event.schemaVersion===2&&owner?.success));
      if(nativeOwnershipLost)markNativeAttentionCoverageLostLocked(this.db,watch,eventKey);
      const advancesSource=sequence>projection.sourceSequence;
      if (advancesSource) {
        projection.sourceSequence = sequence;
        projection.revision++;
        projection.freshness = 'fresh';
        if (!TERMINAL.has(projection.executionState)) {
          if (!preserveNativeBlock&&event.kind !== 'progress' && event.kind !== 'artifact_available' && event.kind !== 'heartbeat') projection.executionState = event.kind === 'started' ? 'running' : event.kind;
          if (watch.source === 'mcp' && event.kind === 'progress' && ['accepted','input_required','blocked'].includes(projection.executionState)) projection.executionState = 'running';
          if (watch.source === 'kswarm' && event.executionStarted === true && projection.executionState === 'accepted') projection.executionState = 'running';
          projection.businessOutcome = event.kind === 'completed' ? event.businessOutcome ?? 'success' : event.kind === 'failed' ? 'error' : event.kind === 'cancelled' ? 'cancelled' : 'unknown';
          if (event.kind !== 'heartbeat') {
            projection.summary = event.summary ?? projection.summary;
            projection.evidenceRefs = [...new Set([...projection.evidenceRefs, ...event.evidenceRefs])].slice(-64);
          }
          if (event.kind === 'heartbeat') projection.lastHeartbeatAt = this.now();
          if (event.kind === 'progress' || event.kind === 'artifact_available') projection.lastProgressAt = this.now();
          if (CRITICAL.has(event.kind) || event.kind === 'progress') {
            this.addActivity(watch, projection, event.kind, event.kind === 'progress' ? `progress:${watchId}` : `${watchId}:${eventKey}`);
          }
        }
      }
      const witness=advancesSource&&!preserveNativeBlock?ordinaryEventWitness(event,watch,eventKey):undefined;
      this.saveProjection(projection,witness&&nativeOwnershipLost?{...witness,invalidatesNativeOwnership:true}:witness);
      this.refreshCard(watch, projection);
      this.db.prepare('INSERT INTO source_cursors VALUES(?,?) ON CONFLICT(watch_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)').run(watchId, sequence);
      return { acknowledge: true };
  }

  private compactSourceProgress(watchId: string, keep: number): void {
    const rows = this.db.prepare(`SELECT event_key FROM source_events WHERE watch_id=? AND json_extract(content_json,'$.kind') IN ('progress','heartbeat')
      ORDER BY json_extract(content_json,'$.sourceSequence') DESC,rowid DESC LIMIT -1 OFFSET ?`).all(watchId, keep) as Array<{ event_key: string }>;
    for (const row of rows) {
      this.db.prepare('DELETE FROM watch_event_receipts WHERE event_key=?').run(row.event_key);
      this.db.prepare('DELETE FROM source_events WHERE event_key=?').run(row.event_key);
    }
  }

  ingestRetainedPage(watchId: string, page: { sourceDataEpoch: string; coveredThrough: number;
    gapRanges: Array<{ from: number; through: number; reason: string }>; events: unknown[] },delivery?:ActivitySourceDelivery): void {
    const gapFailure=this.transaction(() => {
      this.assertNativeSourceWriter(watchId,delivery);
      this.assertProjectSourceWriter(watchId,delivery);
      const source=delivery&&this.projectWrites.get(delivery as ProjectOrdinaryWriteCapability);
      if(source&&(source.step!=='retained'||source.retained!==page))throw Error('activity_project_source_delivery_required');
      const watch = this.getWatch(watchId);
      if (!watch || watch.sourceDataEpoch !== page.sourceDataEpoch) throw new Error('activity_source_mismatch');
      if (watch.status !== 'active' || this.deleted(watch.origin.profileId, watch.origin.threadId)) return;
      if (!Number.isSafeInteger(page.coveredThrough) || page.coveredThrough < 0 || page.events.length > 200 || page.gapRanges.length > 201) throw new Error('invalid_activity_page');
      let previous = -1;
      for (const range of page.gapRanges) {
        if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.through) || range.from < 1 || range.through < range.from
          || range.through > page.coveredThrough || range.from <= previous || !['progress_compacted','retention_expired','mixed_retention_compaction'].includes(range.reason)) throw new Error('invalid_activity_gap');
        previous = range.through;
      }
      if(this.getNativeAttentionEnrollment(watchId)){
        // Validate complete page coverage before any prefix event can be
        // written. A rejected, authenticated page still proves an unknown gap.
        let cursor=this.getProjection(watchId)!.sourceSequence,last=-1;
        const sequences:number[]=[];
        for(const raw of page.events){
          if(!raw||typeof raw!=='object'||Array.isArray(raw)||!id((raw as WorkEvent).eventId))throw Error('activity_event_identity_missing');
          const event=raw as WorkEvent;
          for(const field of ['source','logicalSourceId','sourceDataEpoch','workId','runId'] as const)if((event[field]??'')!==(watch[field]??''))throw Error('activity_source_mismatch');
          const sequence=event.sourceSequence;
          if(!Number.isSafeInteger(sequence)||sequence!<1||sequence!<=last||sequence!>page.coveredThrough)throw Error('invalid_activity_sequence');
          if(page.gapRanges.some(range=>range.from<=sequence!&&range.through>=sequence!))throw Error('activity_gap_conflict');
          sequences.push(sequence!);last=sequence!;
        }
        for(const through of [...sequences.map(sequence=>sequence-1),page.coveredThrough]){
          while(cursor<through){
            const from=cursor+1,range=page.gapRanges.find(item=>item.from<=from&&item.through>=from);
            if(!range){markNativeAttentionCoverageUnknownLocked(this.db,watch,'gap',[watch.sourceDataEpoch,from,through,'uncovered_retained_page']);return Error('activity_source_gap');}
            cursor=Math.min(range.through,through);
          }
          // A listed event covers precisely its own next sequence.
          if(through!==page.coveredThrough)cursor=Math.max(cursor,through+1);
        }
      }
      const cover = (through: number) => {
        let projection = this.getProjection(watchId)!;
        while (projection.sourceSequence < through) {
          const from = projection.sourceSequence + 1;
          const range = page.gapRanges.find(item => item.from <= from && item.through >= from);
          if (!range) throw new Error('activity_source_gap');
          const end = Math.min(range.through, through);
          markNativeAttentionCoverageUnknownLocked(this.db,watch,'gap',[watch.sourceDataEpoch,from,end,range.reason]);
          projection = { ...projection, sourceSequence: end, revision: projection.revision + 1, errorCode: 'activity_history_gap' };
          this.saveProjection(projection,false); this.refreshCard(watch, projection);
          this.addActivity(watch, projection, 'diagnostic', `gap:${watchId}:${from}:${end}:${range.reason}`);
          this.db.prepare('INSERT INTO source_cursors VALUES(?,?) ON CONFLICT(watch_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)').run(watchId, end);
        }
      };
      let lastSequence = -1;
      for (const raw of page.events) {
        const sequence = raw && typeof raw === 'object' ? (raw as WorkEvent).sourceSequence : undefined;
        if (!Number.isSafeInteger(sequence) || sequence! < 1 || sequence! <= lastSequence || sequence! > page.coveredThrough) throw new Error('invalid_activity_sequence');
        lastSequence = sequence!;
        if (page.gapRanges.some(range => range.from <= sequence! && range.through >= sequence!)) throw new Error('activity_gap_conflict');
        cover(sequence! - 1);
        this.ingestLocked(watchId, raw,delivery);
      }
      cover(page.coveredThrough);
    },()=>this.assertProjectSourceWriter(watchId,delivery));
    if(gapFailure)throw gapFailure;
  }

  pruneRetention(): void {
    this.transaction(() => {
      const keys = this.db.prepare(`SELECT r.event_key FROM source_event_retention r JOIN source_events e ON e.event_key=r.event_key
        WHERE r.received_at < ? AND r.kind NOT IN ('input_required','blocked','failed')
        OR r.received_at < ? AND r.kind IN ('progress','heartbeat')`).all(this.now() - 90 * 86400_000, this.now() - 7 * 86400_000) as Array<{ event_key: string }>;
      const protectedTerminalEvents=new Set<string>();
      if(keys.length){
        const sources=this.db.prepare('SELECT w.data_json AS watch_json,p.data_json AS projection_json FROM activity_attention_native_sources n JOIN work_watches w ON w.watch_id=n.watch_id JOIN work_projections p ON p.watch_id=n.watch_id').all() as Array<{watch_json:string;projection_json:string}>;
        for(const source of sources){
          const watch=JSON.parse(source.watch_json) as WorkWatch,projection=JSON.parse(source.projection_json) as WorkProjection;
          if(!TERMINAL.has(projection.executionState))continue;
          const fact=createOrdinaryAttentionFacts(this.db).read(watch,source.projection_json);
          if(fact.sourceRef.kind!=='event')continue;
          const terminal=nativeTerminalInventoryLocked(this.db,watch,projection);
          if(terminal)protectedTerminalEvents.add(terminal.terminalReceipt.eventKey);
        }
      }
      for (const row of keys) {
        if(protectedTerminalEvents.has(row.event_key))continue;
        this.db.prepare('DELETE FROM watch_event_receipts WHERE event_key=?').run(row.event_key);
        this.db.prepare('DELETE FROM source_events WHERE event_key=?').run(row.event_key);
      }
      this.db.prepare(`DELETE FROM notification_attempts WHERE activity_id IN (SELECT activity_id FROM conversation_activities
        WHERE json_extract(data_json,'$.at')<? AND json_extract(data_json,'$.kind') NOT IN ('accepted','input_required','blocked','failed'))`).run(this.now() - 90 * 86400_000);
      this.db.prepare(`DELETE FROM conversation_activities WHERE json_extract(data_json,'$.at')<?
        AND json_extract(data_json,'$.kind') NOT IN ('accepted','input_required','blocked','failed')`).run(this.now() - 90 * 86400_000);
    });
  }

  listActivities(profileId: string, threadId: string, options: { afterLocalSeq?: number; limit?: number } = {}): ConversationActivity[] {
    const after = options.afterLocalSeq ?? 0, limit = options.limit ?? 100;
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('invalid_activity_page');
    if (this.deleted(profileId, threadId)) return [];
    return (this.db.prepare('SELECT local_seq,data_json FROM conversation_activities WHERE profile_id=? AND thread_id=? AND local_seq>? ORDER BY local_seq LIMIT ?')
      .all(profileId, threadId, after, limit) as Array<{ local_seq: number; data_json: string }>).map(row => ({ ...JSON.parse(row.data_json), localSeq: row.local_seq }));
  }

  getActivity(profileId: string, threadId: string, localSeq: number): ConversationActivity | null {
    const row = this.db.prepare('SELECT local_seq,data_json FROM conversation_activities WHERE profile_id=? AND thread_id=? AND local_seq=?')
      .get(profileId, threadId, localSeq) as { local_seq: number; data_json: string } | undefined;
    return row ? { ...JSON.parse(row.data_json), localSeq: row.local_seq } : null;
  }

  unreadByWatch(profileId: string): Array<{ threadId: string; watchId: string; count: number }> {
    return (this.db.prepare(`SELECT a.thread_id AS threadId,a.watch_id AS watchId,COUNT(*) AS count FROM conversation_activities a
      LEFT JOIN conversation_reads r ON r.profile_id=a.profile_id AND r.thread_id=a.thread_id
      WHERE a.profile_id=? AND a.local_seq>COALESCE(r.sequence,0) AND json_extract(a.data_json,'$.kind') NOT IN ('accepted','progress')
      AND NOT EXISTS(SELECT 1 FROM thread_tombstones t WHERE t.profile_id=a.profile_id AND t.thread_id=a.thread_id)
      GROUP BY a.thread_id,a.watch_id`).all(profileId) as Array<{ threadId: string; watchId: string; count: number }>).map(row => ({ ...row }));
  }

  dueWatches(): WorkWatch[] {
    return this.listWatches().filter(watch => watch.status === 'active' && watch.preference === 'normal'
      && watch.nextReportDueAt <= this.now() && !TERMINAL.has(this.getProjection(watch.watchId)!.executionState)
      && !this.deleted(watch.origin.profileId, watch.origin.threadId));
  }

  reportDue(authorizedWatchIds?: ReadonlySet<string>): string[] {
    return this.transaction(() => {
      const reports: string[] = [];
      for (const watch of this.listWatches()) {
        if (authorizedWatchIds && !authorizedWatchIds.has(watch.watchId)) continue;
        const projection = this.getProjection(watch.watchId)!;
        if (watch.status !== 'active' || watch.preference !== 'normal' || TERMINAL.has(projection.executionState)
          || this.deleted(watch.origin.profileId, watch.origin.threadId) || watch.nextReportDueAt > this.now()) continue;
        const key = `report:${watch.watchId}:${watch.policyRevision}:${watch.nextReportDueAt}`;
        projection.lastReportAt = this.now(); projection.revision++;
        this.addActivity(watch, projection, 'report', key);
        this.saveProjection(projection);
        watch.nextReportDueAt = this.now() + REPORT_INTERVAL;
        this.saveWatch(watch); reports.push(watch.watchId);
      }
      return reports;
    });
  }

  updateReporting(profileId: string, watchId: string, preference: ReportingPreference, expectedRevision: number): WorkWatch {
    if (!['normal', 'critical_only', 'quiet'].includes(preference)) throw new Error('invalid_activity_preference');
    return this.transaction(() => {
      const watch = this.ownedWatch(profileId, watchId);
      if (watch.policyRevision !== expectedRevision) throw new Error('activity_policy_conflict');
      watch.preference = preference; watch.policyRevision++; watch.nextReportDueAt = this.now() + REPORT_INTERVAL;
      this.saveWatch(watch); return watch;
    });
  }

  stopWatch(profileId: string, watchId: string, expectedRevision: number): WorkWatch {
    return this.transaction(() => {
      const watch = this.ownedWatch(profileId, watchId);
      if (watch.policyRevision !== expectedRevision) throw new Error('activity_policy_conflict');
      watch.status = 'stopped'; watch.generation++; watch.policyRevision++; this.saveWatch(watch); return watch;
    });
  }

  private ownedWatch(profileId: string, watchId: string): WorkWatch {
    const watch = this.getWatch(watchId);
    if (!watch || watch.origin.profileId !== profileId) throw new Error('activity_watch_forbidden');
    if (this.deleted(profileId, watch.origin.threadId)) throw new Error('activity_thread_deleted');
    return watch;
  }

  private deleted(profileId: string, threadId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM thread_tombstones WHERE profile_id=? AND thread_id=?').get(profileId, threadId));
  }

  deleteThread(profileId: string, threadId: string, operationId: string): void {
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO thread_tombstones VALUES(?,?,?)').run(profileId, threadId, operationId);
      for (const watch of this.listWatches()) if (watch.origin.profileId === profileId && watch.origin.threadId === threadId) {
        watch.status = 'stopped'; watch.generation++; this.saveWatch(watch);
      }
    });
  }

  getDiagnostics(): { quarantined: number; sourceEvents: number } {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM quarantined_events').get() as { count: number };
    return { quarantined: row.count, sourceEvents: (this.db.prepare('SELECT COUNT(*) AS count FROM source_events').get() as { count: number }).count };
  }

  pendingNotifications(limit = 20): ConversationActivity[] {
    return (this.db.prepare(`SELECT a.local_seq,a.data_json FROM conversation_activities a
      LEFT JOIN notification_attempts n ON n.activity_id=a.activity_id
      WHERE n.activity_id IS NULL AND json_extract(a.data_json,'$.kind') IN ('blocked','input_required','completed','failed','cancelled')
      AND NOT EXISTS(SELECT 1 FROM thread_tombstones t WHERE t.profile_id=a.profile_id AND t.thread_id=a.thread_id)
      ORDER BY a.local_seq LIMIT ?`).all(limit) as Array<{ local_seq: number; data_json: string }>)
      .map(row => ({ ...JSON.parse(row.data_json), localSeq: row.local_seq }));
  }

  claimNotification(activityId: string): boolean {
    return this.transaction(() => this.db.prepare('INSERT OR IGNORE INTO notification_attempts VALUES(?,?,?)')
      .run(activityId, 'unknown', this.now()).changes === 1);
  }

  finishNotification(activityId: string, status: 'shown' | 'suppressed' | 'failed'): void {
    this.transaction(() => { this.db.prepare('UPDATE notification_attempts SET status=? WHERE activity_id=?').run(status, activityId); });
  }

  markRead(profileId: string, threadId: string, throughLocalSeq: number): boolean {
    return this.transaction(() => {
      if (!Number.isSafeInteger(throughLocalSeq) || throughLocalSeq < 0) throw new Error('invalid_activity_page');
      const maximum = this.db.prepare('SELECT COALESCE(MAX(local_seq),0) AS maximum FROM conversation_activities WHERE profile_id=? AND thread_id=?').get(profileId, threadId) as { maximum: number };
      if (throughLocalSeq > maximum.maximum) throw new Error('activity_read_cursor_forbidden');
      const current = this.db.prepare('SELECT sequence FROM conversation_reads WHERE profile_id=? AND thread_id=?').get(profileId, threadId) as { sequence: number } | undefined;
      if (throughLocalSeq <= (current?.sequence ?? 0)) return false;
      this.db.prepare('INSERT INTO conversation_reads VALUES(?,?,?) ON CONFLICT(profile_id,thread_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)').run(profileId, threadId, throughLocalSeq);
      return true;
    });
  }

  unreadThreads(profileId: string): Array<{ threadId: string; count: number }> {
    return (this.db.prepare(`SELECT a.thread_id AS threadId, COUNT(*) AS count FROM conversation_activities a
      LEFT JOIN conversation_reads r ON r.profile_id=a.profile_id AND r.thread_id=a.thread_id
      WHERE a.profile_id=? AND a.local_seq>COALESCE(r.sequence,0)
      AND json_extract(a.data_json,'$.kind') NOT IN ('accepted','progress')
      AND NOT EXISTS(SELECT 1 FROM thread_tombstones t WHERE t.profile_id=a.profile_id AND t.thread_id=a.thread_id)
      GROUP BY a.thread_id`).all(profileId) as Array<{ threadId: string; count: number }>).map(row => ({ ...row }));
  }

  setFreshness(watchId: string, freshness: WorkProjection['freshness'], errorCode?: string,delivery?:ActivitySourceDelivery): void {
    this.transaction(() => {
      this.assertNativeSourceWriter(watchId,delivery);
      this.assertProjectSourceWriter(watchId,delivery,freshness!=='fresh');
      const source=delivery&&this.projectWrites.get(delivery as ProjectOrdinaryWriteCapability);
      if(source&&(source.step!=='fresh'||freshness!=='fresh'||errorCode!==undefined))throw Error('activity_project_source_delivery_required');
      const watch = this.getWatch(watchId), projection = this.getProjection(watchId);
      if (!watch || !projection || watch.status !== 'active') return;
      if(watch.source==='kswarm'&&freshness!=='fresh'&&hasProjectDeliveryLineage(this.db,projectActivityAttention(watch,projection).anchorFactId))this.projectDeliveryFacts().invalidate(watchId);
      projection.freshness = freshness;
      if (errorCode !== undefined || projection.errorCode !== 'activity_history_gap') projection.errorCode = errorCode;
      projection.revision++;
      if (freshness === 'fresh') projection.lastHeartbeatAt = this.now();
      this.saveProjection(projection); this.refreshCard(watch, projection);
    },()=>this.assertProjectSourceWriter(watchId,delivery,freshness!=='fresh'));
  }

  reconcileSnapshot(watchId: string, sourceDataEpoch: string, sequence: number, state: WorkProjection['executionState'], historyGap = true,delivery?:ActivitySourceDelivery): void {
    this.transaction(() => {
      this.assertNativeSourceWriter(watchId,delivery);
      this.assertProjectSourceWriter(watchId,delivery);
      const source=delivery&&this.projectWrites.get(delivery as ProjectOrdinaryWriteCapability);
      if(source&&(source.step!=='snapshot'||historyGap||source.snapshot?.epoch!==sourceDataEpoch||source.snapshot.sequence!==sequence||source.snapshot.state!==state))throw Error('activity_project_source_delivery_required');
      const watch = this.getWatch(watchId), projection = this.getProjection(watchId);
      if (!watch || !projection || watch.sourceDataEpoch !== sourceDataEpoch) throw new Error('activity_source_mismatch');
      if (!Number.isSafeInteger(sequence) || sequence < projection.sourceSequence) throw new Error('activity_source_gap');
      if(historyGap)markNativeAttentionCoverageUnknownLocked(this.db,watch,'snapshot',[sourceDataEpoch,sequence,state]);
      projection.sourceSequence = sequence; projection.revision++; projection.freshness = 'fresh';
      const changedState = !TERMINAL.has(projection.executionState) && projection.executionState !== state;
      if (!TERMINAL.has(projection.executionState)) {
        projection.executionState = state;
        projection.businessOutcome = state === 'completed' ? 'success' : state === 'failed' ? 'error' : state === 'cancelled' ? 'cancelled' : 'unknown';
      }
      if (historyGap) projection.errorCode = 'activity_history_gap';
      this.saveProjection(projection,historyGap?false:{kind:'snapshot',id:digest([sourceDataEpoch,sequence,state]),core:{executionState:state,
        businessOutcome:state==='completed'?'success':state==='failed'?'error':state==='cancelled'?'cancelled':'unknown'}}); this.refreshCard(watch, projection);
      if (historyGap) this.addActivity(watch, projection, 'diagnostic', `gap:${watchId}:${sequence}`);
      else if (changedState && TERMINAL.has(state)) this.addActivity(watch, projection, state as 'completed' | 'failed' | 'cancelled', `snapshot:${watchId}:${sourceDataEpoch}:${sequence}:${state}`);
      this.db.prepare('INSERT INTO source_cursors VALUES(?,?) ON CONFLICT(watch_id) DO UPDATE SET sequence=excluded.sequence').run(watchId, sequence);
    },()=>this.assertProjectSourceWriter(watchId,delivery));
  }

  close(): void {
    if (this.closed) { this.readonlySnapshot?.close(); return; }
    this.closed = true;
    this.nativeDeliveries=new WeakMap();
    if (this.readonlySnapshot) { this.readonlySnapshot.close(); return; }
    this.db.close(); this.owner?.close();
  }
}
