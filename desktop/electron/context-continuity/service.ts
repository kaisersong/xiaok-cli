import { randomUUID } from 'node:crypto';
import {definitivePolicyDenial,ContinuityPolicyUnavailable} from '../../../src/runtime/context-continuity/policy-denial.js';
import type { ContinuityConversation, ContinuityMessage, CreateContextReferenceInput, ResolveContextReferenceInput, LegacyDisplayMetadata } from '../../shared/context-continuity-types.js';
import { ContinuityStore, digest, key, effectSnapshotHash, invalidateEffectOwner } from './store.js';
import { ReferenceService } from './references.js';
import type { TaskSnapshot } from '../../shared/task-types.js';
import { ExternalReaderPolicy, type ExternalReferencePrincipal, type IssueExternalReaderInput } from './external-readers.js';
import { NativeContextPolicy } from './native-policy.js';
import { HistorySearch } from './history-search.js';
import {ContextDependencyPolicy} from './dependencies.js';
import { ContinuityInputJournal, type InputOwnerDependencies } from './input-journal.js';
import type { HistorySearchInput, HistorySearchResult } from '../../shared/context-continuity-types.js';

/** Constructed only by authenticated main IPC or a main-owned task binding. */
export interface ContinuityActor {
  requestSource: 'user' | 'agent' | 'scheduler';
  profileId: string;
  actorId: string;
  taskId?: string;
}
export interface RecordMessageInput {
  conversationId: string;
  sourceKind: ContinuityMessage['sourceKind'];
  sourceId: string;
  sourceDataEpoch: string;
  sourceMessageId: string;
  sourceRevision: number;
  role: ContinuityMessage['role'];
  text: string;
  executionState: ContinuityMessage['executionState'];
}
const originalSyncRead=ContinuityStore.prototype.assertSyncScopeReadable,originalSyncMutation=ContinuityStore.prototype.assertSyncScopeForMutation,originalLocalExecution=ContinuityStore.prototype.assertLocalExecution;
const originalCurrentInputExecution=ContinuityInputJournal.prototype.assertCurrentExecution;
export class ContinuityService {
  readonly store: ContinuityStore;
  private readonly references: ReferenceService;
  private readonly externalReaders: ExternalReaderPolicy;
  private readonly nativePolicy:NativeContextPolicy;
  private readonly historySearch:HistorySearch;
  private readonly canonicalReadPolicy:ContextDependencyPolicy;
  private inputOwner?:ContinuityInputJournal;
  bindInputOwner(dependencies:InputOwnerDependencies):ContinuityInputJournal{
    if(this.inputOwner)throw new Error('input_owner_already_bound');
    const owner=new ContinuityInputJournal(this,this.options.dbPath,dependencies);this.inputOwner=owner;return owner;
  }
  /** Main-owned current execution check using its one original input owner. */
  assertCurrentInputExecution(taskId:string):void{
    if(!this.inputOwner)throw new Error('input_owner_unavailable');
    originalCurrentInputExecution.call(this.inputOwner,taskId);
  }
  private scopePolicy?: (id: string) => 'readable' | 'blocked' | 'deleted';
  constructor(private readonly options: { dbPath: string; profileId: string; now?: () => number }) {
    key(options.profileId);
    this.store = new ContinuityStore(options.dbPath, options.profileId);
    this.canonicalReadPolicy=new ContextDependencyPolicy(this.store,id=>this.assertCanonicalExportScope(id));
    this.externalReaders = new ExternalReaderPolicy(this.store,id=>this.assertScopeReadable(id),id=>this.assertTaskReadable(id),id=>this.assertScopeForMutation(id),id=>this.references.assertTaskForMutation(id));
    this.nativePolicy=new NativeContextPolicy(this.store,id=>this.assertScopeReadable(id),id=>this.assertTaskReadable(id));
    this.references = new ReferenceService(this.store, actor => this.assertActor(actor), (actor, id) => this.requireConversation(actor, id), id => this.assertScopeReadable(id),this.externalReaders,(actor,id)=>this.requireConversationForMutation(actor,id),id=>this.assertScopeForMutation(id));
    this.historySearch=new HistorySearch(this);
  }
  issueExternalReader(actor:ContinuityActor,input:IssueExternalReaderInput):{credentialId:string;secret:string}{this.assertActor(actor,true);return this.externalReaders.issue(input);}
  authenticateExternalReader(secret:string):ExternalReferencePrincipal{return this.externalReaders.authenticate(secret);}
  assertExternalReader(principal:ExternalReferencePrincipal):void{this.externalReaders.assert(principal);}
  resolveExternalReference(principal:ExternalReferencePrincipal,input:ResolveContextReferenceInput):import('../../shared/context-continuity-types.js').ContextReferencePage{return this.references.resolve(principal,input,24000);}
  revokeExternalReader(actor:ContinuityActor,id:string):void{this.assertActor(actor,true);this.externalReaders.revoke(id);}
  listExternalReaders(actor:ContinuityActor):ReturnType<ExternalReaderPolicy['list']>{this.assertActor(actor,true);return this.externalReaders.list();}
  acquireNativeContext(actor:ContinuityActor,taskId:string,routeTaskIds:string[]):void{this.assertActor(actor,true);this.nativePolicy.acquire(taskId,routeTaskIds);}
  setScopePolicy(reader: (id: string) => 'readable' | 'blocked' | 'deleted'): void { this.scopePolicy = reader; }
  private deletionGuard?:()=>void;
  setDeletionGuard(guard:()=>void):void{this.deletionGuard=guard;}
  private assertScopeReadable(id: string): void {
    originalSyncRead.call(this.store,id);this.assertExternalScopePolicy(id);
  }
  private assertScopeForMutation(id:string):void{originalSyncMutation.call(this.store,id);this.assertExternalScopePolicy(id);}
  private assertCanonicalExportScope(id:string):void{originalSyncRead.call(this.store,id);this.assertExternalScopePolicy(id,true);}
  private assertExternalScopePolicy(id: string,readOnly=false): void {
    const state:unknown = this.scopePolicy ? this.scopePolicy(id) : 'readable';
    if (state === 'deleted'&&!readOnly) this.tombstoneConversation({ requestSource: 'user', profileId: this.options.profileId, actorId: `desktop-user:${this.options.profileId}` }, id);
    if(state==='blocked'||state==='deleted')throw definitivePolicyDenial();
    if(state!=='readable'){if(state instanceof Promise)void state.catch(()=>{});throw new ContinuityPolicyUnavailable('invalid_scope_result');}
  }
  inspectConversations(actor: ContinuityActor, ids: string[]): Array<{ id: string; state: 'active' | 'missing' | 'blocked' | 'deleted' }> {
    this.assertActor(actor, true);
    if (!Array.isArray(ids) || ids.length > 200) throw new Error('invalid_argument');
    return ids.map(id => {
      key(id); let blocked = false;
      try { this.assertScopeReadable(id); } catch { blocked = true; }
      const row = this.store.db.prepare('SELECT deleted FROM conversations WHERE id=?').get(id);
      return { id, state: row?.deleted ? 'deleted' : blocked ? 'blocked' : row ? 'active' : 'missing' };
    });
  }
  assertActor(actor: ContinuityActor, mutation = false): void {
    if (!actor || actor.profileId !== this.options.profileId || actor.actorId !== `desktop-user:${this.options.profileId}`) throw new Error('not_readable');
    if (!['user', 'agent'].includes(actor.requestSource)) throw new Error('not_readable');
    if (mutation && actor.requestSource !== 'user') throw new Error('user_required');
    if (actor.requestSource === 'agent' && (!actor.taskId || !this.store.db.prepare('SELECT task_id FROM task_bindings WHERE task_id=? AND revoked=0').get(actor.taskId))) throw new Error('not_readable');
  }
  requireConversation(actor: ContinuityActor, id: string): ContinuityConversation {
    this.assertActor(actor); key(id); this.assertScopeReadable(id);
    const row = this.store.db.prepare('SELECT record FROM conversations WHERE id=? AND deleted=0').get(id);
    if (!row) throw new Error('not_readable');
    if (actor.requestSource === 'agent' && this.store.db.prepare('SELECT conversation_id FROM task_bindings WHERE task_id=? AND revoked=0').get(actor.taskId!)?.conversation_id !== id) throw new Error('not_readable');
    return JSON.parse(String(row.record)) as ContinuityConversation;
  }
  /** Export checks never create tombstones or sticky invalidation writes. */
  requireConversationForCanonicalExport(actor:ContinuityActor,id:string):ContinuityConversation{
    this.assertActor(actor,true);key(id);this.assertCanonicalExportScope(id);
    const row=this.store.db.prepare('SELECT record FROM conversations WHERE id=? AND deleted=0').get(id);
    if(!row)throw new Error('not_readable');return JSON.parse(String(row.record))as ContinuityConversation;
  }
  assertTaskReadableForCanonicalExport(taskId:string):void{this.canonicalReadPolicy.assertTaskReadOnly(taskId);}
  private requireConversationForMutation(actor:ContinuityActor,id:string):ContinuityConversation{
    this.assertActor(actor);key(id);this.assertScopeForMutation(id);
    const row=this.store.db.prepare('SELECT record FROM conversations WHERE id=? AND deleted=0').get(id);if(!row)throw new Error('not_readable');
    if(actor.requestSource==='agent'&&this.store.db.prepare('SELECT conversation_id FROM task_bindings WHERE task_id=? AND revoked=0').get(actor.taskId!)?.conversation_id!==id)throw new Error('not_readable');
    return JSON.parse(String(row.record))as ContinuityConversation;
  }
  requireConversationMetadata(actor:ContinuityActor,id:string):ContinuityConversation{this.assertActor(actor,true);return this.requireConversationForMutation(actor,id);}
  assertConversationExecution(id:string):void{originalLocalExecution.call(this.store,id);}
  createConversation(actor: ContinuityActor, input: { operationId: string; title?: string }): ContinuityConversation {
    this.assertActor(actor, true);
    if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 1024)) throw new Error('invalid_argument');
    return this.store.operation('createConversation', input.operationId, input, () => {
      const now = this.options.now?.() ?? Date.now();
      const record: ContinuityConversation = { id: randomUUID(), title: input.title ?? null, status: 'idle', mode: 'work', createdAt: now, updatedAt: now,
        starred: false, gtdBucket: 'inbox', pinnedAt: null, currentTaskId: null, taskIds: [], revision: 0, coverage: 'complete' };
      this.store.db.prepare('INSERT INTO conversations(id,record) VALUES (?,?)').run(record.id, JSON.stringify(record));
      return record;
    });
  }
  /** Internal importer only; adopting an E3 legacy ID requires a verified user-claim manifest. */
  adoptLegacyConversation(actor: ContinuityActor, input: { id: string; title?: string;metadata?:LegacyDisplayMetadata }): ContinuityConversation {
    this.assertActor(actor, true); key(input.id);
    if (this.store.db.prepare('SELECT id FROM conversations WHERE id=?').get(input.id)) {
      if (!this.store.db.prepare('SELECT preview_id FROM legacy_claims WHERE conversation_id=? AND profile_id=? LIMIT 1').get(input.id, this.options.profileId)) throw new Error('source_binding_conflict');
      return this.requireConversation(actor, input.id);
    }
    const now = this.options.now?.() ?? Date.now();
    const m=input.metadata;
    const record: ContinuityConversation = { id: input.id, title: input.title ?? null, status: 'idle', mode: m?.mode??'work', createdAt: m?.createdAt??now, updatedAt: m?.updatedAt??now,
      starred: m?.starred??false, gtdBucket: m?.gtdBucket===undefined?'inbox':m.gtdBucket, pinnedAt: m?.pinnedAt??null,sidebar_work_folder:m?.sidebar_work_folder,currentTaskId: null, taskIds: [], revision: 0, coverage: 'partial' };
    this.store.db.prepare('INSERT INTO conversations(id,record) VALUES (?,?)').run(record.id, JSON.stringify(record)); return record;
  }
  finishLegacyDisplayImport(actor:ContinuityActor,id:string,updatedAt?:number):ContinuityConversation{
    this.assertActor(actor,true);const record=this.requireConversation(actor,id);
    if(!this.store.db.prepare('SELECT 1 FROM legacy_claims WHERE conversation_id=? AND profile_id=?').get(id,this.options.profileId))throw new Error('not_readable');
    if(updatedAt!==undefined){if(!Number.isSafeInteger(updatedAt)||updatedAt<0||updatedAt>8640000000000000)throw new Error('invalid_argument');record.updatedAt=updatedAt;this.store.db.prepare('UPDATE conversations SET record=? WHERE id=?').run(JSON.stringify(record),id);}
    return record;
  }
  getConversation(actor: ContinuityActor, id: string): ContinuityConversation | null {
    this.assertActor(actor);
    let blocked = false; try { this.assertScopeReadable(id); } catch { blocked = true; }
    const row = this.store.db.prepare('SELECT deleted FROM conversations WHERE id=?').get(id);
    const state = row?.deleted ? 'deleted' : blocked ? 'blocked' : row ? 'active' : 'missing';
    if (state === 'deleted') return null; if (state === 'blocked') throw new Error('not_readable');
    if (!this.store.db.prepare('SELECT id FROM conversations WHERE id=? AND deleted=0').get(id)) return null;
    return this.requireConversation(actor, id);
  }
  listConversations(actor: ContinuityActor): ContinuityConversation[] {
    this.assertActor(actor, true);
    return this.store.db.prepare('SELECT id FROM conversations WHERE deleted=0').all().flatMap(row => { try { const c = this.getConversation(actor, String(row.id)); return c ? [c] : []; } catch { return []; } }).sort((a, b) => b.createdAt - a.createdAt);
  }
  updateConversation(actor: ContinuityActor, id: string, patch: Partial<Pick<ContinuityConversation, 'title' | 'mode' | 'starred' | 'gtdBucket' | 'sidebar_work_folder'>>): ContinuityConversation {
    this.assertActor(actor, true);
    const allowed = new Set(['title', 'mode', 'starred', 'gtdBucket', 'sidebar_work_folder']);
    if (Object.keys(patch).some(k => !allowed.has(k))) throw new Error('invalid_argument');
    if (patch.title !== undefined && patch.title !== null && (typeof patch.title !== 'string' || patch.title.length > 1024)) throw new Error('invalid_argument');
    if (patch.mode !== undefined && !['chat', 'work'].includes(patch.mode)) throw new Error('invalid_argument');
    if (patch.starred !== undefined && typeof patch.starred !== 'boolean') throw new Error('invalid_argument');
    if (patch.gtdBucket !== undefined && patch.gtdBucket !== null && !['inbox','todo','waiting','someday','archived'].includes(patch.gtdBucket)) throw new Error('invalid_argument');
    if (patch.sidebar_work_folder !== undefined && patch.sidebar_work_folder !== null && typeof patch.sidebar_work_folder !== 'string') throw new Error('invalid_argument');
    return this.store.transaction(() => {
      const record = { ...this.requireConversationForMutation(actor, id), ...patch };
      if (patch.starred !== undefined) record.pinnedAt = patch.starred ? Date.now() : null;
      return this.saveConversation(record);
    });
  }
  private saveConversation(record: ContinuityConversation): ContinuityConversation {
    record.revision++; record.updatedAt = this.options.now?.() ?? Date.now();
    this.store.db.prepare('UPDATE conversations SET record=? WHERE id=?').run(JSON.stringify(record), record.id);
    return record;
  }
  bindTask(actor: ContinuityActor, input: { conversationId: string; taskId: string }): void {
    this.assertActor(actor, true); key(input.taskId);
    this.assertConversationExecution(input.conversationId);
    this.store.transaction(() => {
      const record = this.requireConversationForMutation(actor, input.conversationId);
      const existing = this.store.db.prepare('SELECT conversation_id,revoked FROM task_bindings WHERE task_id=?').get(input.taskId);
      if (existing && (existing.conversation_id !== record.id || existing.revoked)) throw new Error('source_binding_conflict');
      this.store.db.prepare('INSERT OR IGNORE INTO task_bindings VALUES (?,?,0)').run(input.taskId, record.id);
      if (!record.taskIds.includes(input.taskId)) { record.taskIds.push(input.taskId); record.currentTaskId = input.taskId; this.saveConversation(record); }
    });
  }
  recordMessage(actor: ContinuityActor, input: RecordMessageInput): ContinuityMessage {
    this.assertActor(actor, true);this.assertConversationExecution(input.conversationId);
    for (const value of [input.sourceKind, input.sourceId, input.sourceDataEpoch, input.sourceMessageId]) key(value);
    if (!['desktop_task','cli_session','native_codex','room'].includes(input.sourceKind) || !['user','assistant','tool_summary'].includes(input.role)
      || !['pending','settled','unknown'].includes(input.executionState) || !Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 1
      || typeof input.text !== 'string' || Buffer.byteLength(input.text) > 16 * 1024 * 1024) throw new Error('invalid_argument');
    // Room ownership must be supplied by its broker adapter, never adopted by this private API.
    if (input.sourceKind === 'room') throw new Error('not_readable');
    return this.store.transaction(() => {
      const db = this.store.db, conversation = this.requireConversationForMutation(actor, input.conversationId);
      const binding = db.prepare('SELECT conversation_id FROM source_bindings WHERE kind=? AND id=? AND epoch=?').get(input.sourceKind, input.sourceId, input.sourceDataEpoch);
      if (binding && binding.conversation_id !== conversation.id) throw new Error('source_binding_conflict');
      db.prepare('INSERT OR IGNORE INTO source_bindings VALUES (?,?,?,?)').run(input.sourceKind, input.sourceId, input.sourceDataEpoch, conversation.id);
      const anchor = db.prepare('SELECT * FROM message_anchors WHERE source_kind=? AND source_id=? AND source_epoch=? AND source_message_id=?').get(input.sourceKind, input.sourceId, input.sourceDataEpoch, input.sourceMessageId);
      if (anchor?.deleted) throw new Error('not_readable');
      const contentHash = digest(input.text);
      if (anchor) {
        const prior = db.prepare('SELECT record FROM message_versions WHERE message_id=? AND source_revision=?').get(String(anchor.id), input.sourceRevision);
        if (prior) {
          const record = JSON.parse(String(prior.record)) as ContinuityMessage;
          if (record.contentHash !== contentHash || record.role !== input.role) throw new Error('source_revision_conflict');
          if (anchor.execution_state === 'settled' && input.executionState !== 'settled') throw new Error('source_state_conflict');
          if (anchor.execution_state !== input.executionState) {
            db.prepare('UPDATE message_anchors SET execution_state=? WHERE id=?').run(input.executionState, String(anchor.id));
            this.saveConversation(conversation);
          }
          return { ...record, executionState: input.executionState };
        }
        const latest = db.prepare('SELECT MAX(source_revision) AS revision FROM message_versions WHERE message_id=?').get(String(anchor.id))!;
        if (input.sourceRevision <= Number(latest.revision)) throw new Error('source_revision_conflict');
      }
      const messageId = anchor ? String(anchor.id) : randomUUID(), revision = anchor ? Number(anchor.latest_revision) + 1 : 1;
      const sequence = anchor ? Number(anchor.sequence) : Number(db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM message_anchors WHERE conversation_id=?').get(conversation.id)!.next);
      if (!anchor) db.prepare('INSERT INTO message_anchors VALUES (?,?,?,?,?,?,?,?,?,0)').run(messageId, conversation.id, sequence, input.sourceKind, input.sourceId, input.sourceDataEpoch, input.sourceMessageId, revision, input.executionState);
      else db.prepare('UPDATE message_anchors SET latest_revision=?,execution_state=? WHERE id=?').run(revision, input.executionState, messageId);
      const record: ContinuityMessage = { messageId, revision, sequence, role: input.role, text: input.text, contentHash, sourceKind: input.sourceKind, sourceId: input.sourceId,
        sourceMessageId: input.sourceMessageId, observedAt: this.options.now?.() ?? Date.now(), executionState: input.executionState };
      db.prepare('INSERT INTO message_versions VALUES (?,?,?,?)').run(messageId, revision, input.sourceRevision, JSON.stringify(record));
      this.saveConversation(conversation); return record;
    });
  }
  listMessages(actor: ContinuityActor, id: string): ContinuityMessage[] {
    this.requireConversation(actor, id);
    return this.store.db.prepare('SELECT v.record,a.execution_state FROM message_anchors a JOIN message_versions v ON v.message_id=a.id AND v.revision=a.latest_revision WHERE a.conversation_id=? AND a.deleted=0 ORDER BY a.sequence').all(id)
      .map(row => ({ ...JSON.parse(String(row.record)), executionState: row.execution_state }) as ContinuityMessage)
      .filter(message => { try { this.assertTaskReadable(message.sourceId); return actor.requestSource === 'user' || message.executionState === 'settled'; } catch { return false; } });
  }
  /** Main-only effect admission. No user/model reset exists without a qualified closure owner. */
  recordUnprovenEffect(actor:ContinuityActor,taskId:string,invocationId:string,toolName:string):void{
    this.assertActor(actor,true);key(taskId);key(invocationId);key(toolName);
    invalidateEffectOwner(this.store,taskId,invocationId,toolName);
  }
  registerGuardedRun(actor:ContinuityActor,taskId:string,sourceEpoch:string):void{
    this.assertActor(actor,true);key(taskId);key(sourceEpoch);
    const old=this.store.db.prepare('SELECT source_epoch,policy FROM guarded_effect_runs WHERE task_id=?').get(taskId);
    if(old&&(old.source_epoch!==sourceEpoch||old.policy!==2))throw new Error('blocked_reconciliation');
    this.store.policyMutation(()=>{this.store.db.prepare('INSERT OR IGNORE INTO guarded_effect_runs VALUES (?,?,2)').run(taskId,sourceEpoch);});
  }
  recordEffectOwnerReceipt(actor:ContinuityActor,snapshot:TaskSnapshot):boolean{
    this.assertActor(actor,true);
    if(!['completed','failed','cancelled'].includes(snapshot.status))throw new Error('settlement_receipt_missing');
    return this.store.transaction(()=>{
      const run=this.store.db.prepare('SELECT source_epoch,policy FROM guarded_effect_runs WHERE task_id=?').get(snapshot.taskId);
      if(!run||run.policy!==2||run.source_epoch!==snapshot.sessionId||this.store.db.prepare('SELECT 1 FROM unproven_effects WHERE task_id=? LIMIT 1').get(snapshot.taskId))return false;
      const hash=effectSnapshotHash(snapshot),old=this.store.db.prepare('SELECT * FROM effect_owner_receipts WHERE task_id=?').get(snapshot.taskId);
      if(old&&(old.source_epoch!==snapshot.sessionId||old.event_count!==snapshot.events.length||old.prefix_hash!==digest(snapshot.events)||old.snapshot_hash!==hash))throw new Error('blocked_reconciliation');
      if(!old)this.store.db.prepare('INSERT INTO effect_owner_receipts VALUES (?,?,?,?,?)').run(snapshot.taskId,snapshot.sessionId,snapshot.events.length,digest(snapshot.events),hash);
      return true;
    });
  }
  /** Actual main-loaded history, including unadopted threads; never creates ownership bindings. */
  recordEffectHistory(actor:ContinuityActor,taskId:string,sources:TaskSnapshot[],canonical:boolean):void{
    this.assertActor(actor,true);key(taskId);
    this.store.transaction(()=>{
      for(const source of sources){
        if(source.taskId===taskId)throw new Error('not_readable');
        this.references.assertTaskForMutation(source.taskId);this.assertHistorySourceClosed(source.taskId,source);
        const hash=digest(source.events),snapshotHash=effectSnapshotHash(source),old=this.store.db.prepare('SELECT * FROM effect_history_dependencies WHERE task_id=? AND source_task_id=?').get(taskId,source.taskId);
        if(old&&(!old.valid||old.source_epoch!==source.sessionId||old.event_count!==source.events.length||old.prefix_hash!==hash||old.snapshot_hash!==snapshotHash))throw new Error('not_readable');
        if(!old)this.store.db.prepare('INSERT INTO effect_history_dependencies VALUES (?,?,?,?,?,1,?)').run(taskId,source.taskId,source.sessionId,source.events.length,hash,snapshotHash);
      }
      if(canonical)this.recordHistory(actor,taskId,sources);
    });
  }
  completeEffectInventory(actor:ContinuityActor,snapshots:TaskSnapshot[],legacyOwnerPresent:boolean):void{
    this.assertActor(actor,true);
    this.store.transaction(()=>{
      const certified=this.store.db.prepare('SELECT value FROM continuity_meta WHERE key=?').get('effectInventoryPolicy')?.value==='1';
      if(!certified&&legacyOwnerPresent)this.recordUnprovenEffect(actor,'profile_legacy_owner','owner_inventory','legacy_owner_without_closure');
      for(const snapshot of snapshots){
        // Admission is not closure: a crash may persist a terminal snapshot before
        // the owner receipt, and an old receipt must match the actual durable body.
        try{this.assertHistorySourceClosed(snapshot.taskId,snapshot);}
        catch(error){
          if(!(error instanceof Error)||error.message!=='blocked_unsettled')throw error;
          this.recordUnprovenEffect(actor,snapshot.taskId,'owner_inventory','legacy_task_without_closure');
        }
      }
      this.store.db.prepare('INSERT OR REPLACE INTO continuity_meta VALUES (?,?)').run('effectInventoryPolicy','1');
    });
  }
  assertHistorySourceClosed(taskId:string,snapshot?:TaskSnapshot,seen=new Set<string>()):void{
    this.assertHistoryClosure(taskId,snapshot,seen,false);
  }
  assertHistorySourceClosedForCanonicalExport(taskId:string,snapshot?:TaskSnapshot):void{this.assertHistoryClosure(taskId,snapshot,new Set(),true);}
  private assertHistoryClosure(taskId:string,snapshot:TaskSnapshot|undefined,seen:Set<string>,readOnly:boolean):void{
    key(taskId);if(seen.has(taskId))return;if(seen.size>=512)throw new Error('blocked_unsettled');seen.add(taskId);
    const db=this.store.db;if(db.prepare('SELECT 1 FROM unproven_effects WHERE task_id=? LIMIT 1').get(taskId))throw new Error('blocked_unsettled');
    const run=db.prepare('SELECT source_epoch,policy FROM guarded_effect_runs WHERE task_id=?').get(taskId),receipt=db.prepare('SELECT * FROM effect_owner_receipts WHERE task_id=?').get(taskId);
    if(!run||run.policy!==2||!receipt||!receipt.snapshot_hash||run.source_epoch!==receipt.source_epoch)throw new Error('blocked_unsettled');
    if(snapshot&&(snapshot.taskId!==taskId||snapshot.sessionId!==receipt.source_epoch||snapshot.events.length!==receipt.event_count||digest(snapshot.events)!==receipt.prefix_hash||effectSnapshotHash(snapshot)!==receipt.snapshot_hash))throw new Error('blocked_unsettled');
    for(const row of db.prepare('SELECT * FROM effect_history_dependencies WHERE task_id=?').all(taskId)){
      const source=db.prepare('SELECT * FROM effect_owner_receipts WHERE task_id=?').get(String(row.source_task_id));
      if(!row.valid||!row.snapshot_hash||!source||row.source_epoch!==source.source_epoch||row.event_count!==source.event_count||row.prefix_hash!==source.prefix_hash||row.snapshot_hash!==source.snapshot_hash){
        if(!readOnly)this.store.policyMutation(()=>{db.prepare('UPDATE effect_history_dependencies SET valid=0 WHERE task_id=? AND source_task_id=?').run(taskId,String(row.source_task_id));});throw new Error('blocked_unsettled');
      }
      this.assertHistoryClosure(String(row.source_task_id),undefined,seen,readOnly);
    }
    for(const row of db.prepare('SELECT source_task_id FROM task_history_dependencies WHERE task_id=?').all(taskId))this.assertHistoryClosure(String(row.source_task_id),undefined,seen,readOnly);
    for(const row of db.prepare('SELECT DISTINCT a.source_id FROM context_dependencies d JOIN context_ref_entries e ON e.ref_id=d.ref_id JOIN message_anchors a ON a.id=e.message_id WHERE d.task_id=?').all(taskId)){
      const id=String(row.source_id);if(db.prepare('SELECT 1 FROM unproven_effects WHERE task_id=? LIMIT 1').get(id))throw new Error('blocked_unsettled');
      if(db.prepare('SELECT 1 FROM task_public_inputs WHERE task_id=?').get(id))this.assertHistoryClosure(id,undefined,seen,readOnly);
    }
  }
  assertEffectsClosed():void{if(this.store.db.prepare('SELECT 1 FROM unproven_effects LIMIT 1').get())throw new Error('blocked_unsettled');}
  assertConversationDeletionSafe(actor:ContinuityActor,id:string):void{
    this.assertActor(actor,true);
    this.deletionGuard?.();
    // An unqualified generic command can read any profile source without resolver provenance.
    this.assertEffectsClosed();
    // Unknown native closure includes every retained source and reference in its dependency graph.
    const blocked=this.store.db.prepare(`WITH RECURSIVE native_sources(task_id) AS (
      SELECT task_id FROM task_public_inputs WHERE source_kind='native_codex'
      UNION SELECT d.source_task_id FROM task_history_dependencies d JOIN native_sources n ON n.task_id=d.task_id)
      SELECT 1 FROM native_sources n JOIN task_bindings t ON t.task_id=n.task_id WHERE t.conversation_id=?
      UNION ALL SELECT 1 FROM native_sources n JOIN context_dependencies d ON d.task_id=n.task_id JOIN context_refs r ON r.id=d.ref_id WHERE r.conversation_id=? LIMIT 1`).get(id,id);
    if(blocked)throw new Error('blocked_unsettled');
  }
  deleteMessage(actor: ContinuityActor, input: { conversationId: string; messageId: string }): void {
    this.assertActor(actor, true);
    this.store.transaction(() => {
      const record = this.requireConversationForMutation(actor, input.conversationId);
      this.assertConversationDeletionSafe(actor,record.id);
      const anchor = this.store.db.prepare('SELECT id FROM message_anchors WHERE id=? AND conversation_id=?').get(input.messageId, record.id);
      if (!anchor) throw new Error('not_readable');
      if(this.store.db.prepare('SELECT 1 FROM native_context_fences f JOIN message_anchors a ON a.source_id=f.source_task_id WHERE a.id=? AND f.active=1 LIMIT 1').get(input.messageId))throw new Error('blocked_unsettled');
      this.store.db.prepare('UPDATE message_anchors SET deleted=1 WHERE id=?').run(input.messageId);
      this.store.db.prepare("UPDATE message_versions SET record='{}' WHERE message_id=?").run(input.messageId);
      this.store.db.prepare("UPDATE conversation_inputs SET payload='{}',material_manifest='[]',prepared_payload=NULL,prepared_hash=NULL,deleted=1,status=CASE WHEN status IN ('claimed','unknown') THEN 'unknown' ELSE 'cancelled' END,revision=revision+1 WHERE task_id IN (SELECT source_id FROM message_anchors WHERE id=? AND source_message_id='user')").run(input.messageId);
      this.store.db.prepare("UPDATE conversation_input_files SET record='[]' WHERE input_id IN (SELECT input_id FROM conversation_inputs WHERE deleted=1)").run();
      this.store.db.prepare('UPDATE conversations SET policy_revision=policy_revision+1 WHERE id=?').run(record.id);
      this.saveConversation(record);
    });
  }
  /** Called only after the existing main deletion owner confirms physical cleanup. */
  tombstoneConversation(actor: ContinuityActor, id: string): void {
    this.assertActor(actor, true); key(id);
    this.assertConversationDeletionSafe(actor,id);
    this.store.transaction(() => {
      const db = this.store.db;
      if(db.prepare('SELECT 1 FROM native_context_fences f JOIN task_bindings t ON t.task_id=f.source_task_id WHERE t.conversation_id=? AND f.active=1 LIMIT 1').get(id))throw new Error('blocked_unsettled');
      // A completed legacy deletion also needs a durable marker before any adoption occurred.
      db.prepare('INSERT OR IGNORE INTO conversations(id,record) VALUES (?,?)').run(id, JSON.stringify({ id }));
      db.prepare("UPDATE operations SET result=? WHERE (kind IN ('createConversation','claimLegacy') AND json_extract(result,'$.id')=?) OR (kind='previewLegacy' AND json_extract(result,'$.legacyThreadId')=?)").run(JSON.stringify({ continuityTombstone: true }), id, id);
      db.prepare("UPDATE legacy_previews SET input='{}',record='{}' WHERE json_extract(input,'$.legacyThreadId')=? OR id IN (SELECT preview_id FROM legacy_claims WHERE conversation_id=?)").run(id, id);
      db.prepare('DELETE FROM legacy_candidates WHERE thread_id=?').run(id);
      db.prepare('DELETE FROM legacy_metadata WHERE id=?').run(id);
      db.prepare('UPDATE conversations SET record=?,deleted=1,policy_revision=policy_revision+1 WHERE id=? AND deleted=0').run(JSON.stringify({ id }), id);
      db.prepare("UPDATE message_versions SET record='{}' WHERE message_id IN (SELECT id FROM message_anchors WHERE conversation_id=?)").run(id);
      db.prepare('UPDATE message_anchors SET deleted=1 WHERE conversation_id=?').run(id);
      db.prepare('UPDATE task_bindings SET revoked=1 WHERE conversation_id=?').run(id);
      db.prepare("UPDATE conversation_inputs SET payload='{}',material_manifest='[]',prepared_payload=NULL,prepared_hash=NULL,deleted=1,status=CASE WHEN status IN ('claimed','unknown') THEN 'unknown' ELSE 'cancelled' END,revision=revision+1 WHERE conversation_id=?").run(id);
      db.prepare("UPDATE conversation_input_files SET record='[]' WHERE input_id IN (SELECT input_id FROM conversation_inputs WHERE conversation_id=?)").run(id);
      db.prepare('UPDATE read_grants SET revoked=1,revision=revision+1 WHERE target_conversation=? OR ref_id IN (SELECT id FROM context_refs WHERE conversation_id=?)').run(id, id);
      db.prepare("UPDATE task_public_inputs SET prompt='' WHERE task_id IN (SELECT task_id FROM task_bindings WHERE conversation_id=?)").run(id);
    });
  }
  assertTaskReadable(taskId: string): void { this.references.assertTaskReadable(taskId); }
  recordHistory(actor: ContinuityActor, taskId: string, sources: TaskSnapshot[]): void { this.assertActor(actor, true); this.references.recordHistory(taskId, sources); }
  recordSourceTasks(actor: ContinuityActor, taskId: string, sourceIds: string[]): void { this.assertActor(actor, true); key(taskId); for (const id of sourceIds) key(id); this.references.recordSources(taskId, sourceIds); }
  createReference(actor: ContinuityActor, input: CreateContextReferenceInput) { this.assertActor(actor, true); return this.references.create(actor, input); }
  resolveReference(actor: ContinuityActor, input: ResolveContextReferenceInput) { return this.references.resolve(actor, input); }
  assertReferenceCurrent(page:import('../../shared/context-continuity-types.js').ContextReferencePage,actor:ContinuityActor,input?:ResolveContextReferenceInput):void{this.references.assertResolvedCurrent(page,actor,input);}
  assertExternalReferenceCurrent(page:import('../../shared/context-continuity-types.js').ContextReferencePage,principal:ExternalReferencePrincipal,input?:ResolveContextReferenceInput):void{this.references.assertResolvedCurrent(page,principal,input);}
  attachReference(actor: ContinuityActor, input: { refId: string; targetConversationId: string; operationId: string }) {
    this.assertActor(actor,true);const result=this.references.attach(actor,input);this.historySearch.promote(actor,input,result.grantId);return result;
  }
  /** Main-owned search creates an exact managed grant, never an explicit promotion. */
  attachSearchReference(actor:ContinuityActor,input:{refId:string;targetConversationId:string;operationId:string}){this.assertActor(actor,true);return this.references.attach(actor,input);}
  readSearchReferenceMessage(actor:ContinuityActor,refId:string,messageId:string,revision:number){return this.references.resolveExactMessage(actor,refId,messageId,revision);}
  readSearchReferenceMessageCurrent(actor:ContinuityActor,refId:string,messageId:string,revision:number){return this.references.resolveExactMessage(actor,refId,messageId,revision,false);}
  searchHistory(actor:ContinuityActor,input:HistorySearchInput):HistorySearchResult{return this.historySearch.search(actor,input);}
  assertHistorySearchCurrent(result:HistorySearchResult,actor:ContinuityActor):void{this.historySearch.assertCurrent(result,actor);}
  getHistorySearchConsent(actor:ContinuityActor,conversationId:string){return this.historySearch.getConsent(actor,conversationId);}
  setHistorySearchConsent(actor:ContinuityActor,input:{conversationId:string;enabled:boolean}){return this.historySearch.setConsent(actor,input);}
  getReferenceGrant(actor: ContinuityActor, input: { refId: string; targetConversationId: string }) { this.assertActor(actor, true); return this.references.getGrant(actor, input); }
  getReferenceGrantView(actor:ContinuityActor,input:{refId:string;targetConversationId:string}){
    const grant=this.getReferenceGrant(actor,input);if(!grant)return null;
    const managed=this.store.db.prepare('SELECT 1 FROM history_search_managed_grants WHERE grant_id=? AND target_conversation=?').get(grant.grantId,input.targetConversationId);
    return {...grant,basis:managed?'history_search' as const:'explicit' as const};
  }
  revokeGrant(actor: ContinuityActor, input: { grantId: string }) { this.assertActor(actor, true); return this.references.revoke(input.grantId); }
  close(): void { this.inputOwner?.close();this.store.close(); }
}
