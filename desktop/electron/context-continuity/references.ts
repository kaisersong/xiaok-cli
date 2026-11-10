import { ContextDependencyPolicy } from './dependencies.js';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ContextReferencePage, ContextReferenceView, ContinuityConversation, ContinuityMessage, CreateContextReferenceInput, ResolveContextReferenceInput } from '../../shared/context-continuity-types.js';
import type { ContinuityActor } from './service.js';
import { ContinuityStore, digest, key } from './store.js';
import type { TaskSnapshot } from '../../shared/task-types.js';
import { ExternalReaderPolicy, type ExternalReferencePrincipal } from './external-readers.js';
type Reader = ContinuityActor | ExternalReferencePrincipal;
function external(reader:Reader):reader is ExternalReferencePrincipal { return 'kind' in reader && reader.kind==='external_reader'; }

const originalSyncReference=ContinuityStore.prototype.assertSyncReferenceReadable;
interface Cursor { refId: string; principal: string; policy: string; position: number; offset: number }
export class ReferenceService {
  private readonly resolvedPages=new WeakMap<ContextReferencePage,{actor:Reader;actorHash:string;refId:string;inputHash:string;policy:string;hash:string;position:number;limit:number;rowsHash:string;total:number}>();
  private readonly dependencies: ContextDependencyPolicy;
  constructor(private readonly store: ContinuityStore, private readonly assertActor: (actor: ContinuityActor) => void,
    private readonly conversation: (actor: ContinuityActor, id: string) => ContinuityConversation, private readonly assertScope: (id: string) => void,
    private readonly externalReaders: ExternalReaderPolicy,private readonly mutationConversation:(actor:ContinuityActor,id:string)=>ContinuityConversation=conversation,private readonly mutationScope:(id:string)=>void=assertScope) { this.dependencies = new ContextDependencyPolicy(store, assertScope,mutationScope); }
  assertTaskReadable(taskId: string): void { this.dependencies.assertTaskReadable(taskId); }
  assertTaskForMutation(taskId:string):void{this.dependencies.assertTaskForMutation(taskId);}
  recordHistory(taskId: string, sources: TaskSnapshot[]): void { this.dependencies.recordHistory(taskId, sources); }
  recordSources(taskId: string, sourceIds: string[]): void { this.dependencies.recordSources(taskId, sourceIds); }
  private archiveVisible(messageId: string, revision: number): boolean {
    const row = this.store.db.prepare('SELECT v.record,x.content_hash FROM archive_visibilities x JOIN message_anchors a ON a.id=x.message_id AND a.deleted=0 AND a.source_epoch=x.source_epoch JOIN message_versions v ON v.message_id=x.message_id AND v.revision=x.revision JOIN legacy_claims c ON c.preview_id=x.claim_id AND c.conversation_id=a.conversation_id AND c.profile_id=? WHERE x.message_id=? AND x.revision=?')
      .get(this.store.profileId, messageId, revision);
    return !!row && (JSON.parse(String(row.record)) as ContinuityMessage).contentHash === row.content_hash;
  }
  private syncVisible(messageId:string,revision:number,mutation=false):boolean{
    if(!mutation)return this.store.isAuthenticatedSyncVersion(messageId,revision);
    const row=this.store.db.prepare('SELECT a.conversation_id FROM sync_versions s JOIN message_anchors a ON a.id=s.message_id AND a.deleted=0 WHERE s.message_id=? AND s.revision=?').get(messageId,revision);if(!row)return false;this.mutationScope(String(row.conversation_id));return true;
  }
  create(actor: ContinuityActor, input: CreateContextReferenceInput): ContextReferenceView {
    return this.store.operation('createReference', input.operationId, input, () => {
      const c = this.mutationConversation(actor, input.conversationId), db = this.store.db;
      if (input.expectedRevision !== c.revision) throw new Error('stale_revision');
      const rows = db.prepare('SELECT id,latest_revision FROM message_anchors WHERE conversation_id=? AND deleted=0 ORDER BY sequence').all(c.id);
      let selectedId: string | undefined;
      if (input.sourceMessage) {
        if (input.firstMessageId || input.lastMessageId) throw new Error('invalid_argument');
        const matches = db.prepare('SELECT id FROM message_anchors WHERE conversation_id=? AND source_id=? AND source_message_id=? AND deleted=0').all(c.id, input.sourceMessage.sourceId, input.sourceMessage.sourceMessageId);
        if (matches.length !== 1) throw new Error('snapshot_unavailable');
        selectedId = String(matches[0].id);
      }
      const first = selectedId || input.firstMessageId ? rows.findIndex(row => row.id === (selectedId ?? input.firstMessageId)) : 0;
      const last = selectedId || input.lastMessageId ? rows.findIndex(row => row.id === (selectedId ?? input.lastMessageId)) : rows.length - 1;
      if (first < 0 || last < first || !rows.length) throw new Error('snapshot_unavailable');
      const selected = rows.slice(first, last + 1);
      const frozen = selected.map(row => {
        const version = db.prepare('SELECT record FROM message_versions WHERE message_id=? AND revision=?').get(String(row.id), Number(row.latest_revision))!;
        return [row.id, row.latest_revision, (JSON.parse(String(version.record)) as ContinuityMessage).contentHash];
      });
      const refId = randomBytes(24).toString('base64url'), contentHash = digest(frozen);
      db.prepare('INSERT INTO context_refs VALUES (?,?,?,?)').run(refId, c.id, c.revision, contentHash);
      const insert = db.prepare('INSERT INTO context_ref_entries VALUES (?,?,?,?)');
      selected.forEach((row, position) => insert.run(refId, position, String(row.id), Number(row.latest_revision)));
      return { refId, url: `xiaok://context/v1/${refId}`, conversationId: c.id, snapshotRevision: c.revision, contentHash };
    });
  }
  attach(actor: ContinuityActor, input: { refId: string; targetConversationId: string; operationId: string }): { grantId: string } {
    return this.store.operation('attachReference', input.operationId, input, () => {
      this.mutationConversation(actor, input.targetConversationId);
      const ref = this.store.db.prepare('SELECT conversation_id FROM context_refs WHERE id=?').get(input.refId);
      if (!ref) throw new Error('not_readable');
      this.mutationConversation(actor, String(ref.conversation_id));
      this.authorized(actor, input.refId,true);
      const existing = this.grant(actor, input,true); if (existing) return existing;
      const grantId = randomUUID();
      this.store.db.prepare('INSERT INTO read_grants(id,ref_id,target_conversation) VALUES (?,?,?)').run(grantId, input.refId, input.targetConversationId);
      return { grantId };
    });
  }
  getGrant(actor: ContinuityActor, input: { refId: string; targetConversationId: string }): { grantId: string } | null {return this.grant(actor,input,false);}
  private grant(actor:ContinuityActor,input:{refId:string;targetConversationId:string},mutation:boolean):{grantId:string}|null{
    (mutation?this.mutationConversation:this.conversation)(actor,input.targetConversationId);this.authorized(actor,input.refId,mutation);
    const row = this.store.db.prepare('SELECT id FROM read_grants WHERE ref_id=? AND target_conversation=? AND revoked=0').get(input.refId, input.targetConversationId);
    return row ? { grantId: String(row.id) } : null;
  }
  revoke(grantId: string): void {
    key(grantId);
    this.store.policyMutation(()=>{
      const result = this.store.db.prepare('UPDATE read_grants SET revoked=1,revision=revision+1 WHERE id=?').run(grantId);
      if (!result.changes) throw new Error('not_readable');
    });
  }
  private authorized(actor: Reader, refId: string,mutation=false): { conversationId: string; snapshotRevision: number; policy: string } {
    if(external(actor))this.externalReaders.assert(actor);else this.assertActor(actor);
    const db = this.store.db;if(!mutation)originalSyncReference.call(this.store,refId);
    const ref = db.prepare('SELECT r.*,c.policy_revision FROM context_refs r JOIN conversations c ON c.id=r.conversation_id AND c.deleted=0 WHERE r.id=?').get(refId);
    if (!ref) throw new Error('not_readable');
    (mutation?this.mutationScope:this.assertScope)(String(ref.conversation_id));
    let grantRevision = 'owner';
    if(external(actor))grantRevision=this.externalReaders.access(actor,refId);
    else if (actor.requestSource === 'agent') {
      mutation?this.dependencies.assertTaskForMutation(actor.taskId!):this.assertTaskReadable(actor.taskId!);
      const task = db.prepare('SELECT t.conversation_id,c.policy_revision FROM task_bindings t JOIN conversations c ON c.id=t.conversation_id AND c.deleted=0 WHERE t.task_id=? AND t.revoked=0').get(actor.taskId!);
      if (!task) throw new Error('not_readable');
      (mutation?this.mutationScope:this.assertScope)(String(task.conversation_id));
      if (task.conversation_id !== ref.conversation_id) {
        const grant = db.prepare('SELECT id,revision FROM read_grants WHERE ref_id=? AND target_conversation=? AND revoked=0 ORDER BY id LIMIT 1').get(refId, String(task.conversation_id));
        if (!grant) throw new Error('not_readable');
        grantRevision = `${grant.id}:${grant.revision}:${task.policy_revision}`;
      }
    }
    if(external(actor)||actor.requestSource==='agent'){
      // An explicit archive claim permits only its exact frozen evidence, not general history admission.
      const unsettled = db.prepare('SELECT e.message_id,e.revision,a.execution_state FROM context_ref_entries e JOIN message_anchors a ON a.id=e.message_id WHERE e.ref_id=?').all(refId)
        .some(row => row.execution_state !== 'settled' && !this.archiveVisible(String(row.message_id), Number(row.revision))&&!this.syncVisible(String(row.message_id),Number(row.revision),mutation));
      if (unsettled) throw new Error('not_readable');
    }
    for (const source of db.prepare('SELECT DISTINCT a.source_id FROM context_ref_entries e JOIN message_anchors a ON a.id=e.message_id WHERE e.ref_id=?').all(refId)) mutation?this.dependencies.assertTaskForMutation(String(source.source_id)):this.assertTaskReadable(String(source.source_id));
    if (db.prepare('SELECT e.message_id FROM context_ref_entries e JOIN message_anchors a ON a.id=e.message_id WHERE e.ref_id=? AND a.deleted=1 LIMIT 1').get(refId)) throw new Error('not_readable');
    return { conversationId: String(ref.conversation_id), snapshotRevision: Number(ref.snapshot_revision), policy: `${ref.policy_revision}:${grantRevision}` };
  }
  private encode(cursor: Cursor): string {
    const body = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return `${body}.${createHmac('sha256', this.store.cursorKey).update(body).digest('base64url')}`;
  }
  private decode(value: string): Cursor {
    if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('invalid_cursor');
    const [body, signature] = value.split('.');
    const expected = createHmac('sha256', this.store.cursorKey).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || actual.toString('base64url') !== signature) throw new Error('invalid_cursor');
    try {
      const cursor = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Cursor;
      if (!Number.isSafeInteger(cursor.position) || cursor.position < 0 || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new Error();
      return cursor;
    } catch { throw new Error('invalid_cursor'); }
  }
  resolve(actor: Reader, input: ResolveContextReferenceInput, bodyBudget = 60000): ContextReferencePage {
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid_argument');
    const access = this.authorized(actor, input.refId), principal = external(actor)?digest(['external_reader',actor.profileId,actor.credentialId,actor.targetConversationId]):digest([actor.profileId, actor.actorId, actor.requestSource, actor.taskId ?? null]);
    const cursor = input.cursor ? this.decode(input.cursor) : { refId: input.refId, principal, policy: access.policy, position: 0, offset: 0 };
    if (cursor.refId !== input.refId || cursor.principal !== principal || cursor.policy !== access.policy) throw new Error('invalid_cursor');
    const rows = this.store.db.prepare('SELECT e.position,v.record,a.execution_state FROM context_ref_entries e JOIN message_versions v ON v.message_id=e.message_id AND v.revision=e.revision JOIN message_anchors a ON a.id=e.message_id WHERE e.ref_id=? AND e.position>=? ORDER BY e.position LIMIT ?')
      .all(input.refId, cursor.position, limit + 1);
    const page: ContextReferencePage = { refId: input.refId, conversationId: access.conversationId, snapshotRevision: access.snapshotRevision, messages: [] };
    let position = cursor.position, offset = cursor.offset;
    for (const row of rows.slice(0, limit)) {
      const message = { ...JSON.parse(String(row.record)), executionState: row.execution_state } as ContinuityMessage;
      if (message.executionState !== 'settled' && this.archiveVisible(message.messageId, message.revision)) message.visibilityBasis = 'user_claimed_archive';
      else if(message.executionState!=='settled'&&this.syncVisible(message.messageId,message.revision))message.visibilityBasis='authenticated_sync';
      if (offset > message.text.length) throw new Error('invalid_cursor');
      const remaining = message.text.slice(offset), budget = bodyBudget - Buffer.byteLength(JSON.stringify(page));
      const candidate = { ...message, text: remaining };
      if (Buffer.byteLength(JSON.stringify(candidate)) <= budget) {
        page.messages.push(candidate); position++; offset = 0; continue;
      }
      let low = 0, high = remaining.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(JSON.stringify({ ...message, text: remaining.slice(0, mid), truncated: true })) <= budget) low = mid; else high = mid - 1;
      }
      if (low > 0 && /[\uD800-\uDBFF]/u.test(remaining[low - 1])) low--;
      if (!low) { if (!page.messages.length) throw new Error('budget_exceeded'); break; }
      page.messages.push({ ...message, text: remaining.slice(0, low), truncated: true }); offset += low; break;
    }
    const total = Number(this.store.db.prepare('SELECT COUNT(*) AS count FROM context_ref_entries WHERE ref_id=?').get(input.refId)!.count);
    if (position < total) page.nextCursor = this.encode({ refId: input.refId, principal, policy: access.policy, position, offset });
    if (Buffer.byteLength(JSON.stringify(page)) > 65536) throw new Error('budget_exceeded');
    if(external(actor))this.externalReaders.record(actor,input.refId);
    else if (actor.requestSource === 'agent') {
      const target = this.store.db.prepare('SELECT conversation_id FROM task_bindings WHERE task_id=? AND revoked=0').get(actor.taskId!);
      if (!target) throw new Error('not_readable');
      this.dependencies.record(actor.taskId!, input.refId, String(target.conversation_id));
    }
    const finalAccess=this.authorized(actor,input.refId);
    const finalRows=this.store.db.prepare('SELECT e.position,v.record,a.execution_state FROM context_ref_entries e JOIN message_versions v ON v.message_id=e.message_id AND v.revision=e.revision JOIN message_anchors a ON a.id=e.message_id WHERE e.ref_id=? AND e.position>=? ORDER BY e.position LIMIT ?').all(input.refId,cursor.position,limit+1);
    if(finalAccess.policy!==access.policy||digest(finalRows)!==digest(rows)||Number(this.store.db.prepare('SELECT COUNT(*) AS count FROM context_ref_entries WHERE ref_id=?').get(input.refId)!.count)!==total)throw new Error('not_readable');
    this.resolvedPages.set(page,{actor,actorHash:digest(actor),refId:input.refId,inputHash:digest([input.refId,input.cursor??null,limit]),policy:access.policy,hash:digest(page),position:cursor.position,limit,rowsHash:digest(rows),total});
    return page;
  }
  assertResolvedCurrent(page:ContextReferencePage,actor:Reader,input?:ResolveContextReferenceInput):void{
    const proof=this.resolvedPages.get(page);
    if(!proof||proof.actor!==actor||proof.actorHash!==digest(actor)||proof.hash!==digest(page))throw new Error('not_readable');
    if(input&&proof.inputHash!==digest([input.refId,input.cursor??null,input.limit??20]))throw new Error('not_readable');
    const actual=this.authorized(actor,proof.refId);
    if(actual.policy!==proof.policy||actual.conversationId!==page.conversationId||actual.snapshotRevision!==page.snapshotRevision)throw new Error('not_readable');
    const rows=this.store.db.prepare('SELECT e.position,v.record,a.execution_state FROM context_ref_entries e JOIN message_versions v ON v.message_id=e.message_id AND v.revision=e.revision JOIN message_anchors a ON a.id=e.message_id WHERE e.ref_id=? AND e.position>=? ORDER BY e.position LIMIT ?').all(proof.refId,proof.position,proof.limit+1);
    if(digest(rows)!==proof.rowsHash||Number(this.store.db.prepare('SELECT COUNT(*) AS count FROM context_ref_entries WHERE ref_id=?').get(proof.refId)!.count)!==proof.total)throw new Error('not_readable');
  }
  /** Main search reads an existing exact entry, never a caller-supplied body. */
  resolveExactMessage(actor: ContinuityActor, refId: string, messageId: string, revision: number,consume=true): ContinuityMessage {
    this.authorized(actor, refId);
    const row = this.store.db.prepare('SELECT v.record,a.execution_state FROM context_ref_entries e JOIN message_versions v ON v.message_id=e.message_id AND v.revision=e.revision JOIN message_anchors a ON a.id=e.message_id WHERE e.ref_id=? AND e.message_id=? AND e.revision=?').get(refId,messageId,revision);
    if(!row)throw new Error('not_readable');
    const message={...JSON.parse(String(row.record)),executionState:row.execution_state} as ContinuityMessage;
    if(message.messageId!==messageId||message.revision!==revision||typeof message.text!=='string'||digest(message.text)!==message.contentHash)throw new Error('not_readable');
    if(message.executionState!=='settled'&&this.archiveVisible(messageId,revision))message.visibilityBasis='user_claimed_archive';
    else if(message.executionState!=='settled'&&this.syncVisible(messageId,revision))message.visibilityBasis='authenticated_sync';
    if(actor.requestSource==='agent'){
      const target=this.store.db.prepare('SELECT conversation_id FROM task_bindings WHERE task_id=? AND revoked=0').get(actor.taskId!);
      if(!target)throw new Error('not_readable');if(consume)this.dependencies.record(actor.taskId!,refId,String(target.conversation_id));else this.dependencies.assertConsumed(actor.taskId!,refId);
    }
    this.authorized(actor,refId);const actual=this.store.db.prepare('SELECT record FROM message_versions WHERE message_id=? AND revision=?').get(messageId,revision);if(!actual||JSON.parse(String(actual.record)).contentHash!==message.contentHash)throw new Error('not_readable');
    return message;
  }
}
