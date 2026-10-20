import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, chmodSync, mkdirSync, openSync, closeSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import {types} from 'node:util';
import {captureCanonicalStoreState,type CanonicalStoreState} from './sync-canonical-state.js';
import {ContinuityPolicyUnavailable,definitivePolicyDenial} from '../../../src/runtime/context-continuity/policy-denial.js';
import type {DesktopSyncDevice} from './sync-device-runtime.js';
import type {CanonicalStoreSyncBinding,CanonicalStoreSyncOwner} from './sync-canonical-store-owner.js';
import type { TaskSnapshot } from '../../shared/task-types.js';

export function digest(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
/** Versioned durable JSON semantics, independent of object key insertion order. */
export function effectSnapshotHash(snapshot:TaskSnapshot):string{
  const durable=JSON.parse(JSON.stringify(snapshot));
  const normalized=JSON.stringify([2,durable],(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
  return digest(normalized);
}
export function key(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f]/u.test(value)) throw new Error('invalid_argument');
}
function operationResult<T>(value: unknown): T {
  const result = JSON.parse(String(value));
  if (result && typeof result === 'object' && result.continuityTombstone === true) throw new Error('not_readable');
  return result as T;
}
export interface OriginalCanonicalStoreChannel {
 readonly db:DatabaseSync;readonly profileId:string;readonly storeId:string;
 capture():CanonicalStoreState;assertIdle():void;stage(planHash:string):object;assertStage(stage:object):void;assertMetadataStage(stage:object):void;
 importStage<T>(stage:object,fn:()=>T):T;
 assertCommitted(receipt:object):CanonicalStoreState;
 currentCommitted():object|undefined;
}
let claimStoreChannel:(store:ContinuityStore,token:object)=>OriginalCanonicalStoreChannel;
export function claimOriginalCanonicalStoreChannel(store:ContinuityStore,token:object):OriginalCanonicalStoreChannel{return claimStoreChannel(store,token);}
export class ContinuityStore {
  readonly db: DatabaseSync;
  readonly cursorKey: Buffer;
  #database!:DatabaseSync;
  #syncOwner?:CanonicalStoreSyncOwner;
  #pendingBind?:{token:object;claimed:boolean};
  #phase:'idle'|'before-begin'|'writing'|'post-commit'|'closed'='idle';
  #generation=0;#faulted=false;#bindAttempted=false;
  #stages=new WeakMap<object,{generation:number;planHash:string}>();
  #commits=new WeakMap<object,{generation:number;stage?:object;state:CanonicalStoreState}>();
  #currentCommit?:object;#activeStage?:object;
  static {claimStoreChannel=(store,token)=>{
    if(!store||typeof store!=='object'||!(#pendingBind in store)||store.closed||store.#pendingBind?.token!==token||store.#pendingBind.claimed)throw new Error('canonical_store_binding_unavailable');
    store.#pendingBind.claimed=true;const db=store.#database,storeId=String(db.prepare('SELECT value FROM continuity_meta WHERE key=?').get('storeUUID')?.value);
    const channel:OriginalCanonicalStoreChannel=Object.freeze({db,profileId:store.profileId,storeId,
      capture:()=>captureCanonicalStoreState(db),
      assertIdle:()=>{if(store.closed||store.#faulted||store.#pendingBind||store.#phase!=='idle'||store.depth!==0||db.isTransaction)throw new ContinuityPolicyUnavailable('canonical_store_not_idle');},
      stage:(planHash:string)=>{if(store.closed||store.#faulted||store.#phase!=='idle'||!/^[a-f0-9]{64}$/.test(planHash))throw new Error('canonical_stage_unavailable');const cap=Object.freeze({kind:'original-canonical-stage'});store.#stages.set(cap,{generation:store.#generation,planHash});return cap;},
      assertStage:(cap:object)=>store.#assertStage(cap),
      assertMetadataStage:(cap:object)=>{store.#assertStage(cap);const stage=store.#stages.get(cap);if(store.closed||store.#faulted||store.#pendingBind||store.#phase!=='writing'||store.depth!==1||!db.isTransaction||store.#activeStage!==cap||(stage?.generation??-2)+1!==store.#generation)throw new ContinuityPolicyUnavailable('canonical_metadata_stage_unavailable');},
      importStage:<T>(cap:object,fn:()=>T):T=>{store.#assertStage(cap);if(store.#phase!=='idle')throw new Error('canonical_stage_unavailable');store.#activeStage=cap;try{return store.transaction(fn);}finally{store.#activeStage=undefined;}},
      currentCommitted:()=>store.#currentCommit,
      assertCommitted:(cap:object)=>{const entry=store.#commits.get(cap);if(!entry||store.closed||store.#faulted||store.#phase==='before-begin'||store.#phase==='writing'||db.isTransaction||entry.generation!==store.#generation||cap!==store.#currentCommit)throw new ContinuityPolicyUnavailable('canonical_commit_unavailable');if(entry.stage){const original=store.#stages.get(entry.stage);if(!original||store.#activeStage!==entry.stage&&store.#phase==='post-commit')throw new ContinuityPolicyUnavailable('canonical_stage_unavailable');}const state=captureCanonicalStoreState(db);if(state.policyHash!==entry.state.policyHash||state.publicationHash!==entry.state.publicationHash)throw new ContinuityPolicyUnavailable('canonical_rows_changed');return state;},
    });return channel;
  };}
  private closed = false;
  private depth = 0;
  private savepoint = 0;
  constructor(path: string, readonly profileId: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (existsSync(path)) {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('profile_mismatch');
      const probe = new DatabaseSync(path, { readOnly: true });
      try {
        const tables = probe.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all();
        if (tables.length) {
          if (!tables.some(row => row.name === 'continuity_meta') || probe.prepare("SELECT value FROM continuity_meta WHERE key='profileId'").get()?.value !== profileId) throw new Error('profile_mismatch');
          if (probe.prepare("SELECT value FROM continuity_meta WHERE key='schemaVersion'").get()?.value !== '1') throw new Error('unsupported_schema');
        }
      } finally { probe.close(); }
      chmodSync(path, 0o600); // Only this verified, current-user-owned private file.
    }
    if (!existsSync(path)) {
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); closeSync(fd);
    }
    this.db = new DatabaseSync(path);this.#database=this.db;
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
      this.transaction(() => {
      this.db.exec(`        CREATE TABLE IF NOT EXISTS continuity_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_store_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_scopes (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), origin_scope TEXT NOT NULL UNIQUE, manifest_hash TEXT NOT NULL, candidate_hash TEXT NOT NULL, stage_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_sources (local_source_id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES sync_scopes(conversation_id),source_kind TEXT NOT NULL,origin_id TEXT NOT NULL,origin_epoch TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_versions (message_id TEXT NOT NULL REFERENCES message_anchors(id),revision INTEGER NOT NULL,origin_message_id TEXT NOT NULL,origin_hash TEXT NOT NULL,dependencies TEXT NOT NULL,PRIMARY KEY(message_id,revision));
        CREATE TABLE IF NOT EXISTS sync_refs (local_ref_id TEXT PRIMARY KEY REFERENCES context_refs(id),conversation_id TEXT NOT NULL REFERENCES sync_scopes(conversation_id),origin_ref_id TEXT NOT NULL,origin_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_revocations (origin_scope TEXT NOT NULL,kind TEXT NOT NULL,origin_id TEXT NOT NULL,local_id TEXT NOT NULL,revision INTEGER NOT NULL,record_hash TEXT NOT NULL,PRIMARY KEY(origin_scope,kind,origin_id));
        CREATE TABLE IF NOT EXISTS sync_grants (local_grant_id TEXT PRIMARY KEY REFERENCES read_grants(id),conversation_id TEXT NOT NULL REFERENCES sync_scopes(conversation_id),origin_id TEXT NOT NULL,origin_revision INTEGER NOT NULL,target_scope TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, record TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, policy_revision INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS conversation_execution (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), authority TEXT NOT NULL, execution_epoch INTEGER NOT NULL, harness TEXT NOT NULL, barrier TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conversation_inputs (input_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), sequence INTEGER NOT NULL, payload_hash TEXT NOT NULL, payload TEXT NOT NULL, material_manifest TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE, source_epoch TEXT NOT NULL, authority TEXT NOT NULL, execution_epoch INTEGER NOT NULL, status TEXT NOT NULL, claim_boot TEXT, revision INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, UNIQUE(conversation_id,sequence));
        CREATE TABLE IF NOT EXISTS conversation_input_files (input_id TEXT PRIMARY KEY REFERENCES conversation_inputs(input_id), request_hash TEXT NOT NULL, record TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS operations (kind TEXT NOT NULL, id TEXT NOT NULL, request_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS legacy_metadata (id TEXT PRIMARY KEY, title TEXT);
        CREATE TABLE IF NOT EXISTS legacy_display_metadata (thread_id TEXT PRIMARY KEY REFERENCES legacy_metadata(id) ON DELETE CASCADE, record TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS legacy_candidates (thread_id TEXT NOT NULL REFERENCES legacy_metadata(id), task_id TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(thread_id,task_id), UNIQUE(thread_id,position));
        CREATE TABLE IF NOT EXISTS legacy_previews (id TEXT PRIMARY KEY, input TEXT NOT NULL, record TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS legacy_claims (preview_id TEXT PRIMARY KEY REFERENCES legacy_previews(id), profile_id TEXT NOT NULL, manifest_hash TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id));
        CREATE TABLE IF NOT EXISTS source_bindings (kind TEXT NOT NULL, id TEXT NOT NULL, epoch TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id), PRIMARY KEY(kind,id,epoch));
        CREATE TABLE IF NOT EXISTS message_anchors (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), sequence INTEGER NOT NULL, source_kind TEXT NOT NULL, source_id TEXT NOT NULL, source_epoch TEXT NOT NULL, source_message_id TEXT NOT NULL, latest_revision INTEGER NOT NULL, execution_state TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
          UNIQUE(source_kind,source_id,source_epoch,source_message_id), UNIQUE(conversation_id,sequence));
        CREATE TABLE IF NOT EXISTS message_versions (message_id TEXT NOT NULL REFERENCES message_anchors(id), revision INTEGER NOT NULL, source_revision INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY(message_id,revision), UNIQUE(message_id,source_revision));
        CREATE TABLE IF NOT EXISTS archive_visibilities (message_id TEXT NOT NULL, revision INTEGER NOT NULL, source_epoch TEXT NOT NULL, content_hash TEXT NOT NULL, claim_id TEXT NOT NULL REFERENCES legacy_claims(preview_id), PRIMARY KEY(message_id,revision), FOREIGN KEY(message_id,revision) REFERENCES message_versions(message_id,revision));
        CREATE TABLE IF NOT EXISTS context_refs (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), snapshot_revision INTEGER NOT NULL, content_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS context_ref_entries (ref_id TEXT NOT NULL REFERENCES context_refs(id), position INTEGER NOT NULL, message_id TEXT NOT NULL REFERENCES message_anchors(id), revision INTEGER NOT NULL, PRIMARY KEY(ref_id,position));
        CREATE TABLE IF NOT EXISTS read_grants (id TEXT PRIMARY KEY, ref_id TEXT NOT NULL REFERENCES context_refs(id), target_conversation TEXT NOT NULL REFERENCES conversations(id), revision INTEGER NOT NULL DEFAULT 1, revoked INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS history_search_consents (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), enabled INTEGER NOT NULL, revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS history_search_managed_grants (grant_id TEXT PRIMARY KEY REFERENCES read_grants(id), target_conversation TEXT NOT NULL REFERENCES conversations(id), consent_revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS external_readers (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL UNIQUE, target_conversation TEXT NOT NULL REFERENCES conversations(id), target_policy INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS external_reader_refs (credential_id TEXT NOT NULL REFERENCES external_readers(id), ref_id TEXT NOT NULL REFERENCES context_refs(id), grant_id TEXT NOT NULL REFERENCES read_grants(id), grant_revision INTEGER NOT NULL, source_policy INTEGER NOT NULL, PRIMARY KEY(credential_id,ref_id));
        CREATE TABLE IF NOT EXISTS external_reader_dependencies (credential_id TEXT NOT NULL REFERENCES external_readers(id), ref_id TEXT NOT NULL REFERENCES context_refs(id), valid INTEGER NOT NULL, PRIMARY KEY(credential_id,ref_id));
        CREATE TABLE IF NOT EXISTS context_dependencies (task_id TEXT NOT NULL, ref_id TEXT NOT NULL REFERENCES context_refs(id), policy_revision INTEGER NOT NULL, grant_id TEXT, grant_revision INTEGER, target_conversation TEXT NOT NULL REFERENCES conversations(id), valid INTEGER NOT NULL, PRIMARY KEY(task_id,ref_id));
        CREATE TABLE IF NOT EXISTS task_history_dependencies (task_id TEXT NOT NULL, source_task_id TEXT NOT NULL REFERENCES task_bindings(task_id), source_epoch TEXT NOT NULL, event_count INTEGER NOT NULL, prefix_hash TEXT NOT NULL, policy_revision INTEGER NOT NULL, valid INTEGER NOT NULL, PRIMARY KEY(task_id,source_task_id));
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_read_grant ON read_grants(ref_id,target_conversation) WHERE revoked=0;
        CREATE TABLE IF NOT EXISTS task_bindings (task_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), revoked INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS task_public_inputs (task_id TEXT PRIMARY KEY REFERENCES task_bindings(task_id), prompt TEXT NOT NULL, source_kind TEXT NOT NULL, include_user INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS task_presentation_sources (task_id TEXT PRIMARY KEY REFERENCES task_bindings(task_id), version INTEGER NOT NULL, source_epoch TEXT NOT NULL, raw_prompt_hash TEXT NOT NULL, scope_hash TEXT NOT NULL, input_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS source_cursors (source_kind TEXT NOT NULL, source_id TEXT NOT NULL, source_epoch TEXT NOT NULL, event_count INTEGER NOT NULL, prompt_hash TEXT NOT NULL, terminal_status TEXT, PRIMARY KEY(source_kind,source_id,source_epoch));
        CREATE TABLE IF NOT EXISTS guarded_effect_runs (task_id TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, policy INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS effect_owner_receipts (task_id TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, event_count INTEGER NOT NULL, prefix_hash TEXT NOT NULL, snapshot_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS effect_history_dependencies (task_id TEXT NOT NULL, source_task_id TEXT NOT NULL, source_epoch TEXT NOT NULL, event_count INTEGER NOT NULL, prefix_hash TEXT NOT NULL, valid INTEGER NOT NULL, snapshot_hash TEXT NOT NULL, PRIMARY KEY(task_id,source_task_id));
        CREATE TABLE IF NOT EXISTS unproven_effects (task_id TEXT NOT NULL, invocation_id TEXT NOT NULL, tool_name TEXT NOT NULL, PRIMARY KEY(task_id,invocation_id));
        CREATE TABLE IF NOT EXISTS source_settlements (task_id TEXT PRIMARY KEY REFERENCES task_bindings(task_id), source_epoch TEXT NOT NULL, event_count INTEGER NOT NULL, prefix_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS native_context_fences (native_task_id TEXT NOT NULL REFERENCES task_bindings(task_id), native_epoch TEXT NOT NULL, source_task_id TEXT NOT NULL REFERENCES task_bindings(task_id), source_epoch TEXT NOT NULL, active INTEGER NOT NULL, PRIMARY KEY(native_task_id,source_task_id));
        CREATE TABLE IF NOT EXISTS projection_failures (task_id TEXT PRIMARY KEY REFERENCES task_bindings(task_id), code TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS source_event_digests (source_kind TEXT NOT NULL, source_id TEXT NOT NULL, source_epoch TEXT NOT NULL, sequence INTEGER NOT NULL, event_hash TEXT NOT NULL, PRIMARY KEY(source_kind,source_id,source_epoch,sequence));
      `);
        for(const column of ['prepared_payload','prepared_hash','execution_authority'])if(!this.db.prepare('PRAGMA table_info(conversation_inputs)').all().some(row=>row.name===column))this.db.exec(`ALTER TABLE conversation_inputs ADD COLUMN ${column} TEXT`);
        // Never reconstruct missing proof from the current, potentially changed checkpoint.
        if(!this.db.prepare('PRAGMA table_info(effect_owner_receipts)').all().some(row=>row.name==='snapshot_hash'))this.db.exec('ALTER TABLE effect_owner_receipts ADD COLUMN snapshot_hash TEXT');
        if(!this.db.prepare('PRAGMA table_info(effect_history_dependencies)').all().some(row=>row.name==='snapshot_hash'))this.db.exec('ALTER TABLE effect_history_dependencies ADD COLUMN snapshot_hash TEXT');
        if(this.db.prepare('SELECT value FROM continuity_meta WHERE key=?').get('effectReceiptPolicy')?.value!=='2'){
          this.db.exec("INSERT OR IGNORE INTO unproven_effects SELECT task_id,'legacy-body-receipt','legacy_incomplete_effect_receipt' FROM guarded_effect_runs WHERE policy<>2; DELETE FROM effect_owner_receipts; UPDATE effect_history_dependencies SET valid=0; DELETE FROM source_settlements WHERE task_id IN (SELECT task_id FROM unproven_effects); UPDATE message_anchors SET execution_state='unknown' WHERE source_id IN (SELECT task_id FROM unproven_effects)");
          this.db.prepare('INSERT OR REPLACE INTO continuity_meta VALUES (?,?)').run('effectReceiptPolicy','2');
        }
        if(!this.db.prepare('SELECT value FROM continuity_meta WHERE key=?').get('storeUUID')){
          if(this.db.prepare('SELECT 1 FROM sync_store_state LIMIT 1').get()||this.db.prepare('SELECT 1 FROM sync_scopes LIMIT 1').get())throw new Error('canonical_store_identity_missing');
          this.db.prepare('INSERT INTO continuity_meta VALUES (?,?)').run('storeUUID',randomUUID());
        }
        this.db.prepare('INSERT OR IGNORE INTO continuity_meta VALUES (?,?)').run('profileId', profileId);
        if (this.db.prepare('SELECT value FROM continuity_meta WHERE key=?').get('profileId')?.value !== profileId) throw new Error('profile_mismatch');
        // Earlier prerelease parent-turn receipts never proved background/delegated execution closure.
        this.db.exec("DELETE FROM source_settlements WHERE task_id IN (SELECT task_id FROM task_public_inputs WHERE source_kind='native_codex'); UPDATE message_anchors SET execution_state='unknown' WHERE source_kind='native_codex'; UPDATE native_context_fences SET active=1");
        if(this.db.prepare('SELECT value FROM continuity_meta WHERE key=?').get('effectClosurePolicy')?.value!=='1'){
          // Pre-policy receipts only proved runner/parent IO, not generic tool descendants.
          this.db.exec("INSERT OR IGNORE INTO unproven_effects SELECT task_id,'legacy-settlement','legacy_unqualified_owner' FROM source_settlements; DELETE FROM source_settlements; UPDATE message_anchors SET execution_state='unknown' WHERE source_id IN (SELECT task_id FROM unproven_effects)");
          this.db.prepare('INSERT OR REPLACE INTO continuity_meta VALUES (?,?)').run('effectClosurePolicy','1');
        }
        this.db.prepare('INSERT OR IGNORE INTO continuity_meta VALUES (?,?)').run('schemaVersion', '1');
        if (this.db.prepare('SELECT value FROM continuity_meta WHERE key=?').get('schemaVersion')?.value !== '1') throw new Error('unsupported_schema');
        this.db.prepare('INSERT OR IGNORE INTO continuity_meta VALUES (?,?)').run('cursorKey', randomBytes(32).toString('hex'));
      });
      const encodedKey = String(this.db.prepare('SELECT value FROM continuity_meta WHERE key=?').get('cursorKey')!.value);
      if (!/^[a-f0-9]{64}$/.test(encodedKey)) throw new Error('invalid_cursor_key');
      this.cursorKey = Buffer.from(encodedKey, 'hex');
      chmodSync(path, 0o600);
    } catch (error) { this.db.close(); throw error; }
  }
  #assertStage(cap:object):void{
    const stage=this.#stages.get(cap);if(!stage||this.closed||this.#faulted||stage.generation!==this.#generation&&!(this.#activeStage===cap&&stage.generation+1===this.#generation))throw new Error('canonical_stage_unavailable');
  }
  async bindCanonicalSyncDevice(device:DesktopSyncDevice):Promise<CanonicalStoreSyncBinding>{
    if(this.closed||this.#pendingBind||this.#syncOwner||this.#phase!=='idle')throw new Error('canonical_store_binding_unavailable');
    this.#bindAttempted=true;const token=Object.freeze({});this.#pendingBind={token,claimed:false};
    try{
      const module=await import('./sync-canonical-store-owner.js');
      this.#captureBindingCommit(token);
      const owner=module.createCanonicalStoreSyncOwner(this,token,device);
      if(this.closed||this.#pendingBind?.token!==token)throw new Error('canonical_store_binding_unavailable');
      module.assertOriginalCanonicalStoreSyncOwner(this,owner);this.#syncOwner=owner;this.#pendingBind=undefined;return owner.binding;
    }catch(error){this.#faulted=true;this.#pendingBind=undefined;throw error;}
  }
  #captureBindingCommit(token:object):void{
    if(this.closed||this.#faulted||this.#pendingBind?.token!==token||this.#phase!=='idle'||this.depth)throw new ContinuityPolicyUnavailable('canonical_store_binding_unavailable');
    this.#phase='before-begin';const generation=++this.#generation;this.#currentCommit=undefined;this.#commits=new WeakMap();let began=false;
    try{
      this.#database.exec('BEGIN IMMEDIATE');began=true;const intended=captureCanonicalStoreState(this.#database);
      this.#database.exec('COMMIT');began=false;if(this.#database.isTransaction)throw new ContinuityPolicyUnavailable('canonical_commit_unavailable');this.#phase='post-commit';
      const state=captureCanonicalStoreState(this.#database);if(state.policyHash!==intended.policyHash||state.publicationHash!==intended.publicationHash)throw new ContinuityPolicyUnavailable('canonical_rows_changed');
      if(this.closed||this.#pendingBind?.token!==token||this.#generation!==generation||this.#phase!=='post-commit'||this.#database.isTransaction)throw new ContinuityPolicyUnavailable('canonical_store_binding_unavailable');
      const cap=Object.freeze({kind:'original-canonical-bind-commit'});this.#commits.set(cap,{generation:this.#generation,state});this.#currentCommit=cap;
    }catch(error){this.#currentCommit=undefined;this.#commits=new WeakMap();if(began&&this.#database.isTransaction)this.#database.exec('ROLLBACK');throw error;}
    finally{if(!this.closed)this.#phase='idle';}
  }
  /** Actual COMMIT/state component only; no source/body/OS-current authority. */
  captureCanonicalSourceState(device:DesktopSyncDevice,conversationIds:readonly string[]):object{
    const owner=this.#syncOwner;
    if(this.closed||this.#faulted||this.#pendingBind||this.#phase!=='idle'||this.depth!==0||this.#database.isTransaction||!owner)throw new ContinuityPolicyUnavailable('canonical_source_state_unavailable');
    const cap=owner.captureSourceState(device,conversationIds);
    if(this.closed||this.#faulted||this.#pendingBind||this.#phase!=='idle'||this.depth!==0||this.#database.isTransaction||this.#syncOwner!==owner)throw new ContinuityPolicyUnavailable('canonical_source_state_unavailable');
    return cap;
  }
  /** Separate genesis/reconcile draft only; never a registered source proof. */
  captureCanonicalSourceDraft(device:DesktopSyncDevice,conversationIds:readonly string[]):object{
    const owner=this.#syncOwner;
    if(this.closed||this.#faulted||this.#pendingBind||this.#phase!=='idle'||this.depth!==0||this.#database.isTransaction||!owner)throw new ContinuityPolicyUnavailable('canonical_source_state_unavailable');
    const cap=owner.captureSourceDraft(device,conversationIds);
    if(this.closed||this.#faulted||this.#pendingBind||this.#phase!=='idle'||this.depth!==0||this.#database.isTransaction||this.#syncOwner!==owner)throw new ContinuityPolicyUnavailable('canonical_source_state_unavailable');
    return cap;
  }
  /** Original fixed main-source friend only; caller draft DTOs cannot register. */
  bootstrapCanonicalSource(device:DesktopSyncDevice,services:object,draft:object,controls:unknown):Promise<object>{
    const owner=this.#syncOwner;if(this.closed||this.#faulted||this.#pendingBind||this.#phase!=='idle'||this.depth||this.#database.isTransaction||!owner)throw new ContinuityPolicyUnavailable('canonical_source_bootstrap_unavailable');
    return owner.bootstrapSource(device,services,draft,controls);
  }
  #affected(id:string):boolean{return !!this.#database.prepare('SELECT 1 FROM sync_scopes WHERE conversation_id=?').get(id);}
  assertSyncScopeReadable(id:string):void{
    if(this.closed)throw new ContinuityPolicyUnavailable('canonical_store_closed');
    if(this.#pendingBind||this.#faulted)throw new ContinuityPolicyUnavailable('canonical_sync_unavailable');
    if(!this.#affected(id))return;
    if(this.#pendingBind||this.#faulted||this.#phase!=='idle'||this.#database.isTransaction||!this.#syncOwner)throw new ContinuityPolicyUnavailable('canonical_sync_unavailable');
    this.#syncOwner.assertScope(id);
  }
  /** Internal metadata validation only. Never returns a body or read capability. */
  assertSyncScopeForMutation(id:string):void{
    if(this.closed||this.#pendingBind||this.#faulted)throw new ContinuityPolicyUnavailable('canonical_sync_unavailable');
    if(!this.#affected(id))return;
    if(this.closed||this.#faulted||!this.#syncOwner||this.#pendingBind)throw new ContinuityPolicyUnavailable('canonical_sync_unavailable');
    if(this.#phase==='writing')this.#syncOwner.assertMutationScope(id);else this.assertSyncScopeReadable(id);
  }
  assertSyncSourceReadable(id:string):void{
    const row=this.#database.prepare('SELECT conversation_id FROM sync_sources WHERE local_source_id=?').get(id);if(row)this.assertSyncScopeReadable(String(row.conversation_id));
  }
  assertSyncReferenceReadable(id:string):void{
    const row=this.#database.prepare('SELECT s.conversation_id,s.origin_ref_id,c.origin_scope FROM sync_refs s JOIN sync_scopes c ON c.conversation_id=s.conversation_id WHERE s.local_ref_id=?').get(id);if(!row)return;this.assertSyncScopeReadable(String(row.conversation_id));
    if(this.#database.prepare("SELECT 1 FROM sync_revocations WHERE origin_scope=? AND kind='reference' AND origin_id=?").get(String(row.origin_scope),String(row.origin_ref_id)))throw definitivePolicyDenial();
  }
  assertLocalExecution(id:string):void{if(this.#affected(id))throw new Error('execution_transfer_required');}
  isAuthenticatedSyncVersion(id:string,revision:number):boolean{
    const row=this.#database.prepare('SELECT a.conversation_id FROM sync_versions s JOIN message_anchors a ON a.id=s.message_id AND a.deleted=0 WHERE s.message_id=? AND s.revision=?').get(id,revision);
    if(!row)return false;this.assertSyncScopeReadable(String(row.conversation_id));return true;
  }
  /** All main-owned policy changes share this actual transaction owner. */
  policyMutation<T>(fn: () => T): T { return this.transaction(fn); }
  transaction<T>(fn: () => T): T {
    if(this.closed)throw new Error('continuity_store_closed');
    if(this.#bindAttempted&&(this.#faulted||this.#pendingBind))throw new ContinuityPolicyUnavailable('canonical_sync_unavailable');
    const nested = this.depth > 0, point = `continuity_${++this.savepoint}`;
    let began=false,completed=false;
    if(!nested){
      if(this.#phase!=='idle')throw new ContinuityPolicyUnavailable('canonical_write_in_progress');
      this.#phase='before-begin';this.#generation++;this.#commits=new WeakMap();this.#currentCommit=undefined;
    }
    try{
      if(!nested)this.#syncOwner?.beforeWrite();
      this.#database.exec(nested ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE');began=true;this.depth++;if(!nested)this.#phase='writing';
      const result = fn();
      if(result!==null&&(typeof result==='object'||typeof result==='function')){
        if(types.isProxy(result)||types.isPromise(result)){this.#faulted=true;throw new Error('async_transaction_not_supported');}
        for(let object:object|null=result;object!==null;object=Object.getPrototypeOf(object)){
          if(types.isProxy(object)||Object.getOwnPropertyDescriptor(object,'then')){this.#faulted=true;throw new Error('async_transaction_not_supported');}
        }
      }
      if(!nested)this.#syncOwner?.prepareCommit();
      this.#database.exec(nested ? `RELEASE ${point}` : 'COMMIT');completed=true;
      if(!nested&&this.#syncOwner){
        this.#phase='post-commit';if(this.#database.isTransaction)throw new ContinuityPolicyUnavailable('canonical_commit_unavailable');
        const cap=Object.freeze({kind:'original-canonical-commit'}),state=captureCanonicalStoreState(this.#database);this.#commits.set(cap,{generation:this.#generation,stage:this.#activeStage,state});this.#currentCommit=cap;
        this.#syncOwner?.afterCommit(cap);
      }
      return result;
    }catch(error){
      if(!nested){this.#currentCommit=undefined;this.#commits=new WeakMap();this.#syncOwner?.writeFailed();}
      if(began&&!completed&&this.#database.isTransaction)this.#database.exec(nested ? `ROLLBACK TO ${point}; RELEASE ${point}` : 'ROLLBACK');
      throw error;
    }finally{if(began)this.depth--;if(!nested&&!this.closed)this.#phase='idle';}
  }
  existingOperation<T>(kind: string, id: string, request: unknown): { result: T } | null {
    key(id);
    const row = this.db.prepare('SELECT request_hash,result FROM operations WHERE kind=? AND id=?').get(kind, id);
    if (!row) return null;
    if (row.request_hash !== digest(request)) throw new Error('operation_conflict');
    return { result: operationResult<T>(row.result) };
  }
  operation<T>(kind: string, id: string, request: unknown, run: () => T): T {
    key(id);
    return this.transaction(() => {
      const hash = digest(request);
      const row = this.db.prepare('SELECT request_hash,result FROM operations WHERE kind=? AND id=?').get(kind, id);
      if (row) {
        if (row.request_hash !== hash) throw new Error('operation_conflict');
        return operationResult<T>(row.result);
      }
      const result = run();
      this.db.prepare('INSERT INTO operations VALUES (?,?,?,?)').run(kind, id, hash, JSON.stringify(result));
      return result;
    });
  }
  close(): void { if (!this.closed) { this.closed=true;this.#phase='closed';this.#generation++;this.#currentCommit=undefined;this.#commits=new WeakMap();this.#stages=new WeakMap();this.#syncOwner?.close();this.#database.close();this.#syncOwner?.databaseClosed(); } }
}

/** Shared main-only invalidation primitive. This only removes closure authority;
 * no actor or model-facing path can use it to reset an unknown effect. */
export function invalidateEffectOwner(store:ContinuityStore,taskId:string,invocationId:string,toolName:string,requireFresh=false):void{
  key(taskId);key(invocationId);key(toolName);
  store.transaction(()=>{
    // Model-controlled call IDs never share an owner namespace with native
    // resources. Keep the reservation after drain; tool names cannot override it.
    // No negative table-existence cache: ordinary SDK startup can precede native.
    if(!requireFresh&&store.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='native_model_resources'").get()
      &&store.db.prepare('SELECT 1 FROM native_model_resources WHERE task_id=? AND id=?').get(taskId,invocationId))throw new Error('effect_invocation_owner_conflict');
    if(requireFresh&&store.db.prepare('SELECT 1 FROM unproven_effects WHERE task_id=? AND invocation_id=?').get(taskId,invocationId))throw new Error('effect_invocation_owner_conflict');
    store.db.prepare(requireFresh?'INSERT INTO unproven_effects VALUES (?,?,?)':'INSERT OR IGNORE INTO unproven_effects VALUES (?,?,?)').run(taskId,invocationId,toolName);
    store.db.prepare('DELETE FROM source_settlements WHERE task_id=?').run(taskId);
    store.db.prepare('DELETE FROM effect_owner_receipts WHERE task_id=?').run(taskId);
    store.db.prepare("UPDATE message_anchors SET execution_state='unknown' WHERE source_id=?").run(taskId);
  });
}
