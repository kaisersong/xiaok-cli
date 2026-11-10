import type { DatabaseSync } from 'node:sqlite';
import {assertCliArchiveSource} from './cli-archive-policy.js';
import {definitivePolicyDenial,isDefinitivePolicyDenial,ContinuityPolicyUnavailable} from './policy-denial.js';

export type DependencyTable = 'effect_history_dependencies' | 'task_history_dependencies' | 'context_dependencies';
/** One evaluator for main's write owner and readonly consumers; no implicit storage mutation. */
export function assertContinuityTaskReadable(taskId: string, options: {
  db: Pick<DatabaseSync, 'prepare'>;
  scope(id: string): 'readable' | 'blocked' | 'deleted';
  syncSource?(id:string):void;
  invalidate?(table: DependencyTable, taskId: string, sourceId: string): void;
}): void {
  if(typeof taskId!=='string'||!taskId||taskId.length>256||/[\u0000-\u001f]/u.test(taskId))throw new Error('not_readable');
  const assertScopeCurrent = (id:string):void => {
    const state:unknown=options.scope(id);if(state==='readable')return;
    if(state==='blocked'||state==='deleted')throw definitivePolicyDenial();
    if(state instanceof Promise)void state.catch(()=>{});
    throw new ContinuityPolicyUnavailable('invalid_scope_result');
  };
  const denyDependency=(error:unknown,table:DependencyTable,owner:string,source:string):never=>{
    if(isDefinitivePolicyDenial(error)){options.invalidate?.(table,owner,source);throw error;}
    if(error instanceof ContinuityPolicyUnavailable)throw error;
    throw new ContinuityPolicyUnavailable('source_proof_unavailable',{cause:error});
  };
  const visit = (taskId: string, visiting = new Set<string>(), budget = { remaining: 512 }): void => {
    if (visiting.has(taskId)) return;
    if (--budget.remaining < 0) throw new Error('not_readable');
    visiting.add(taskId);
    const db = options.db;
    const hasSync=db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sync_sources'").get();
    const imported=hasSync&&db.prepare('SELECT 1 FROM sync_sources WHERE local_source_id=?').get(taskId);
    if(imported){if(!options.syncSource)throw new ContinuityPolicyUnavailable('live_sync_owner_required');const result:unknown=options.syncSource(taskId);if(result!==undefined)throw new ContinuityPolicyUnavailable('invalid_sync_source_result');}
    else assertCliArchiveSource(taskId,options);
    const own = db.prepare('SELECT t.conversation_id,t.revoked,c.deleted FROM task_bindings t JOIN conversations c ON c.id=t.conversation_id WHERE t.task_id=?').get(taskId);
    if (own) {
      if (own.revoked || own.deleted) throw definitivePolicyDenial();
      assertScopeCurrent(String(own.conversation_id));
    }
    if (db.prepare('SELECT id FROM message_anchors WHERE source_id=? AND deleted=1 LIMIT 1').get(taskId)) throw definitivePolicyDenial();
    for(const dep of db.prepare('SELECT * FROM effect_history_dependencies WHERE task_id=?').all(taskId)){
      try{
        if(!dep.valid)throw definitivePolicyDenial();
        const receipt=db.prepare('SELECT * FROM effect_owner_receipts WHERE task_id=?').get(String(dep.source_task_id));
        if(!dep.snapshot_hash||!receipt||receipt.source_epoch!==dep.source_epoch||receipt.event_count!==dep.event_count||receipt.prefix_hash!==dep.prefix_hash||receipt.snapshot_hash!==dep.snapshot_hash)throw definitivePolicyDenial();
        visit(String(dep.source_task_id),visiting,budget);
      }catch(error){
        denyDependency(error,'effect_history_dependencies',taskId,String(dep.source_task_id));
      }
    }
    for (const dep of db.prepare('SELECT * FROM task_history_dependencies WHERE task_id=?').all(taskId)) {
      try {
        if (!dep.valid) throw definitivePolicyDenial();
        const source = db.prepare('SELECT t.conversation_id,t.revoked,c.deleted,c.policy_revision FROM task_bindings t JOIN conversations c ON c.id=t.conversation_id WHERE t.task_id=?').get(String(dep.source_task_id));
        if (!source || source.revoked || source.deleted || source.policy_revision !== dep.policy_revision) throw definitivePolicyDenial();
        assertScopeCurrent(String(source.conversation_id));
        visit(String(dep.source_task_id), visiting, budget);
      } catch(error) {
        denyDependency(error,'task_history_dependencies',taskId,String(dep.source_task_id));
      }
    }
    for (const dep of db.prepare('SELECT * FROM context_dependencies WHERE task_id=?').all(taskId)) {
      try {
        if (!dep.valid) throw definitivePolicyDenial();
        const source = db.prepare('SELECT r.conversation_id,c.policy_revision,c.deleted FROM context_refs r JOIN conversations c ON c.id=r.conversation_id WHERE r.id=?').get(String(dep.ref_id));
        if (!source || source.deleted || source.policy_revision !== dep.policy_revision) throw definitivePolicyDenial();
        assertScopeCurrent(String(source.conversation_id));
        if (dep.grant_id) {
          const grant = db.prepare('SELECT revoked,revision FROM read_grants WHERE id=?').get(String(dep.grant_id));
          if (!grant || grant.revoked || grant.revision !== dep.grant_revision) throw definitivePolicyDenial();
        }
        const messages = db.prepare('SELECT a.source_id,a.deleted FROM context_ref_entries e JOIN message_anchors a ON a.id=e.message_id WHERE e.ref_id=?').all(String(dep.ref_id));
        if (!messages.length || messages.some(row => row.deleted)) throw definitivePolicyDenial();
        for (const message of messages) visit(String(message.source_id), visiting, budget);
      } catch(error) {
        denyDependency(error,'context_dependencies',taskId,String(dep.ref_id));
      }
    }
  };
  visit(taskId);
}
