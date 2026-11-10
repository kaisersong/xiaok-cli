import {digest} from './store.js';
import type { OwnedTaskHistory } from '../../../src/runtime/task-host/task-runtime-host.js';
import type { TaskCreateContext } from '../../../src/runtime/task-host/types.js';
import type { ContinuityMessage } from '../../shared/context-continuity-types.js';
import type { ContinuityActor, ContinuityService } from './service.js';

/** Main canonical public history is mandatory. Renderer task IDs can never omit it. */
export function assembleOwnedHistory(service: ContinuityService, actor: ContinuityActor, taskId: string, context?: TaskCreateContext): OwnedTaskHistory | null {
  if (!context?.threadId) return null;
  service.assertConversationExecution(context.threadId);
  const read=()=>{
    const conversation=service.getConversation(actor,context.threadId!);if(!conversation)throw new Error('not_readable');
    if(service.store.db.prepare("SELECT 1 FROM source_bindings WHERE kind='cli_session' AND conversation_id=? LIMIT 1").get(conversation.id))throw new Error('cli_archive_read_only');
    const sources = conversation.taskIds.filter(id => id !== taskId), db = service.store.db;
    if ((context.taskIds ?? []).some(id => id !== taskId && !sources.includes(id))) throw new Error('not_readable');
    for (const sourceId of sources) {
      service.assertTaskReadable(sourceId);
      service.assertHistorySourceClosed(sourceId);
      if (db.prepare('SELECT task_id FROM projection_failures WHERE task_id=?').get(sourceId)) throw new Error('blocked_reconciliation');
      const binding = db.prepare('SELECT conversation_id,revoked FROM task_bindings WHERE task_id=?').get(sourceId);
      if (!binding || binding.revoked || binding.conversation_id !== conversation.id) throw new Error('not_readable');
      const coverage = db.prepare('SELECT p.source_kind,c.source_epoch,c.event_count,s.source_epoch AS settled_epoch,s.event_count AS settled_count FROM task_public_inputs p LEFT JOIN source_cursors c ON c.source_id=p.task_id AND c.source_kind=p.source_kind LEFT JOIN source_settlements s ON s.task_id=p.task_id WHERE p.task_id=?').all(sourceId);
      // Native's bounded display projection cannot claim full history before its full-source adapter exists.
      if (coverage.some(row => row.source_kind === 'native_codex')) throw new Error('source_partial');
      if (coverage.length !== 1 || coverage[0].source_epoch !== coverage[0].settled_epoch || coverage[0].event_count !== coverage[0].settled_count) throw new Error('blocked_unsettled');
    }
    const rows = db.prepare('SELECT v.record,a.source_id,a.execution_state FROM message_anchors a JOIN message_versions v ON v.message_id=a.id AND v.revision=a.latest_revision WHERE a.conversation_id=? AND a.deleted=0 ORDER BY a.sequence').all(conversation.id).filter(row => sources.includes(String(row.source_id)));
    if (rows.some(row => row.execution_state !== 'settled')) throw new Error('blocked_unsettled');
    const history = rows.map(row => { const message = JSON.parse(String(row.record)) as ContinuityMessage; return { role: message.role === 'user' ? 'user' as const : 'assistant' as const, content: message.text }; });
    // Explicitly block instead of silently cutting mandatory constraints. P2 checkpoints own bounded omissions.
    if (Buffer.byteLength(JSON.stringify(history)) > 96 * 1024) throw new Error('context_budget_exceeded');
    return {manifest:digest([conversation,sources,rows]),history,sources,conversationId:conversation.id};
  };
  const before=read();
  // Only the original positive dependency metadata is written. Every public
  // source/body check and the returned mandatory history follows real COMMIT.
  service.recordSourceTasks(actor,taskId,before.sources);
  const current=read();if(current.manifest!==before.manifest)throw new Error('not_readable');
  return {history:current.history,audit:{threadId:current.conversationId,taskIds:current.sources,loadedTaskIds:current.sources,skipped:[]}};
}
