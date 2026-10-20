import { assertContinuityTaskReadable } from '../../../src/runtime/context-continuity/policy.js';
import { ContinuityStore, digest } from './store.js';
import type { TaskSnapshot } from '../../shared/task-types.js';

const originalSyncSource=ContinuityStore.prototype.assertSyncSourceReadable;
/** Once a run has consumed revoked context it cannot become clean through a new grant. */
export class ContextDependencyPolicy {
  constructor(private readonly store: ContinuityStore, private readonly assertScope: (id: string) => void,private readonly mutationScope:(id:string)=>void=assertScope) {}
  private assertCanConsume(taskId:string):void{
    if(this.store.db.prepare('SELECT 1 FROM native_context_fences WHERE source_task_id=? AND active=1 LIMIT 1').get(taskId))throw new Error('native_context_frozen');
  }
  assertTaskReadable(taskId: string): void {this.assertUsing(taskId,this.assertScope);}
  assertTaskReadOnly(taskId:string):void{this.assertUsing(taskId,this.assertScope,false,true);}
  assertTaskForMutation(taskId:string):void{this.assertUsing(taskId,this.mutationScope,true);}
  private assertUsing(taskId:string,scope:(id:string)=>void,mutation=false,readOnly=false):void{
    assertContinuityTaskReadable(taskId, { db: this.store.db, syncSource:id=>{if(mutation){const row=this.store.db.prepare('SELECT conversation_id FROM sync_sources WHERE local_source_id=?').get(id);if(row)this.mutationScope(String(row.conversation_id));}else originalSyncSource.call(this.store,id);}, scope: id => { const result:unknown=scope(id); if(result!==undefined)throw new Error('not_readable'); return 'readable'; },
      invalidate: readOnly?undefined:(table, taskId, sourceId) => {
        const sourceColumn = table === 'context_dependencies' ? 'ref_id' : 'source_task_id';
        this.store.policyMutation(()=>{this.store.db.prepare(`UPDATE ${table} SET valid=0 WHERE task_id=? AND ${sourceColumn}=?`).run(taskId, sourceId);});
      },
    });
  }
  recordHistory(taskId: string, sources: TaskSnapshot[]): void {
    this.store.transaction(() => {
      this.assertCanConsume(taskId);
      for (const source of sources) {
        if (source.taskId === taskId) throw new Error('not_readable');
        this.assertTaskForMutation(source.taskId);
        const binding = this.store.db.prepare('SELECT t.conversation_id,t.revoked,c.policy_revision FROM task_bindings t JOIN conversations c ON c.id=t.conversation_id WHERE t.task_id=?').get(source.taskId);
        if (!binding || binding.revoked || binding.conversation_id !== source.context?.threadId) throw new Error('not_readable');
        this.mutationScope(String(binding.conversation_id));
        this.store.db.prepare('INSERT OR IGNORE INTO task_history_dependencies VALUES (?,?,?,?,?,?,1)').run(taskId, source.taskId, source.sessionId, source.events.length, digest(source.events), Number(binding.policy_revision));
      }
    });
  }
  recordSources(taskId: string, sourceIds: string[]): void {
    this.store.transaction(() => {
      this.assertCanConsume(taskId);
      for (const sourceId of new Set(sourceIds)) {
        this.assertTaskForMutation(sourceId); if (sourceId === taskId) continue;
        const source = this.store.db.prepare('SELECT t.conversation_id,t.revoked,c.policy_revision FROM task_bindings t JOIN conversations c ON c.id=t.conversation_id WHERE t.task_id=?').get(sourceId);
        if (!source || source.revoked) throw new Error('not_readable');
        this.mutationScope(String(source.conversation_id));
        const epochs = this.store.db.prepare('SELECT source_epoch,event_count FROM source_cursors WHERE source_id=?').all(sourceId);
        const bindings = this.store.db.prepare('SELECT DISTINCT epoch AS source_epoch FROM source_bindings WHERE id=?').all(sourceId);
        if(epochs.length>1||bindings.length!==1||epochs.length===1&&epochs[0].source_epoch!==bindings[0].source_epoch)throw new Error('not_readable');
        const epoch=String(bindings[0].source_epoch);
        const head = this.store.db.prepare('SELECT id,latest_revision FROM message_anchors WHERE source_id=? ORDER BY sequence').all(sourceId);
        this.store.db.prepare('INSERT OR IGNORE INTO task_history_dependencies VALUES (?,?,?,?,?,?,1)').run(taskId, sourceId, epoch, Number(epochs[0]?.event_count ?? 0), digest(head), Number(source.policy_revision));
      }
    });
  }
  assertConsumed(taskId:string,refId:string):void{if(!this.store.db.prepare('SELECT 1 FROM context_dependencies WHERE task_id=? AND ref_id=? AND valid=1').get(taskId,refId))throw new Error('not_readable');this.assertTaskReadable(taskId);}
  record(taskId: string, refId: string, targetConversation: string): void {
    this.store.policyMutation(()=>{
    this.assertCanConsume(taskId);
    const db = this.store.db;
    const source = db.prepare('SELECT r.conversation_id,c.policy_revision FROM context_refs r JOIN conversations c ON c.id=r.conversation_id WHERE r.id=?').get(refId)!;
    const grant = source.conversation_id === targetConversation ? null : db.prepare('SELECT id,revision FROM read_grants WHERE ref_id=? AND target_conversation=? AND revoked=0').get(refId, targetConversation);
    if (source.conversation_id !== targetConversation && !grant) throw new Error('not_readable');
    db.prepare('INSERT OR IGNORE INTO context_dependencies VALUES (?,?,?,?,?,?,1)').run(taskId, refId, source.policy_revision as number, grant ? String(grant.id) : null, grant ? Number(grant.revision) : null, targetConversation);
    });
  }
}
