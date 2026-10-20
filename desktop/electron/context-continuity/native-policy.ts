import { ContinuityStore } from './store.js';

/** Native auto tools have no complete main admission gate. Do not expose revocable references to them. */
export class NativeContextPolicy {
  constructor(private readonly store:ContinuityStore,private readonly assertScope:(id:string)=>void,private readonly assertTask:(id:string)=>void){}
  acquire(nativeTaskId:string,routeTaskIds:string[]):void{
    this.store.transaction(()=>{
      const db=this.store.db,current=db.prepare("SELECT source_epoch FROM source_cursors WHERE source_id=? AND source_kind='native_codex'").all(nativeTaskId);
      if(current.length!==1)throw new Error('native_context_unknown');
      const target=db.prepare('SELECT conversation_id FROM task_bindings WHERE task_id=? AND revoked=0').get(nativeTaskId);if(!target)throw new Error('native_context_unknown');
      const epoch=String(current[0].source_epoch),seen=new Set<string>(),pending=[nativeTaskId,...routeTaskIds];
      while(pending.length){
        const taskId=pending.pop()!;if(seen.has(taskId))continue;if(seen.size>=512)throw new Error('native_context_unknown');seen.add(taskId);
        this.assertTask(taskId);
        const owner=db.prepare('SELECT c.id,c.record FROM task_bindings t JOIN conversations c ON c.id=t.conversation_id WHERE t.task_id=? AND t.revoked=0 AND c.deleted=0').get(taskId);
        if(!owner)throw new Error('native_context_unknown');this.assertScope(String(owner.id));
        if(owner.id!==target.conversation_id)throw new Error('native_revocable_context_unsupported');
        if(JSON.parse(String(owner.record)).coverage!=='complete'||db.prepare('SELECT 1 FROM projection_failures WHERE task_id=?').get(taskId))throw new Error('native_context_unknown');
        if(db.prepare('SELECT 1 FROM context_dependencies WHERE task_id=?').get(taskId))throw new Error('native_revocable_context_unsupported');
        const cursors=db.prepare('SELECT source_epoch,event_count,source_kind FROM source_cursors WHERE source_id=?').all(taskId);
        if(cursors.length!==1)throw new Error('native_context_unknown');
        if(taskId!==nativeTaskId){
          const settled=db.prepare('SELECT source_epoch,event_count FROM source_settlements WHERE task_id=?').get(taskId);
          if(!settled||settled.source_epoch!==cursors[0].source_epoch||settled.event_count!==cursors[0].event_count)throw new Error('blocked_unsettled');
          if(cursors[0].source_kind==='native_codex')throw new Error('native_source_coverage_unsupported');
        }
        for(const edge of db.prepare('SELECT source_task_id FROM task_history_dependencies WHERE task_id=?').all(taskId))pending.push(String(edge.source_task_id));
      }
      const insert=db.prepare('INSERT INTO native_context_fences VALUES (?,?,?,?,1) ON CONFLICT(native_task_id,source_task_id) DO NOTHING');
      for(const taskId of seen){
        const source=db.prepare('SELECT source_epoch FROM source_cursors WHERE source_id=?').get(taskId)!;
        const existing=db.prepare('SELECT native_epoch,source_epoch,active FROM native_context_fences WHERE native_task_id=? AND source_task_id=?').get(nativeTaskId,taskId);
        if(existing&&(existing.native_epoch!==epoch||existing.source_epoch!==source.source_epoch||existing.active!==1))throw new Error('native_context_unknown');
        insert.run(nativeTaskId,epoch,taskId,String(source.source_epoch));
      }
    });
  }
}
