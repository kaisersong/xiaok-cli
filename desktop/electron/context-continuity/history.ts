import { AsyncLocalStorage } from 'node:async_hooks';
import {digest} from './store.js';
import type { OwnedTaskHistory } from '../../../src/runtime/task-host/task-runtime-host.js';
import type { TaskContextSkip, TaskCreateContext, TaskSnapshot } from '../../../src/runtime/task-host/types.js';
import type { ContinuityMessage } from '../../shared/context-continuity-types.js';
import type { ContinuityActor, ContinuityService } from './service.js';
import { isAssistantThread } from '../../shared/assistant-inbox-contract.js';

/** Server-side marks for thread IDs Main itself minted for unthreaded Chat. Renderer input never lands here. */
/** Bounded and one-shot: a mark is consumed by the request's first history read and the oldest marks are evicted. */
const MINTED_LOCAL_THREAD_LIMIT=256;
const mintedLocalThreads=new Set<string>();
const assistantUserHistory = new AsyncLocalStorage<{ threadId: string; taskId?: string }>();
const assistantReadEffects = new Set(['read_material', 'read', 'assistant_list_files', 'web_search']);

/** Main's typed foreground submission enters this scope after user admission. */
export function withAssistantUserHistory<T>(threadId: string, submit: () => T): T {
  if (!isAssistantThread(threadId)) throw Error('assistant_history_scope_invalid');
  return assistantUserHistory.run({ threadId }, submit);
}
export function markMintedLocalThread(threadId: string): string {
  mintedLocalThreads.add(threadId);
  while(mintedLocalThreads.size>MINTED_LOCAL_THREAD_LIMIT)mintedLocalThreads.delete(mintedLocalThreads.values().next().value as string);
  return threadId;
}
export function mintedLocalThreadCount(): number { return mintedLocalThreads.size; }

/** Main canonical public history is mandatory. Renderer task IDs can never omit it. */
export function assembleOwnedHistory(service: ContinuityService, actor: ContinuityActor, taskId: string, context?: TaskCreateContext,
  inspectPriorSource?: (id: string) => TaskSnapshot | null): OwnedTaskHistory | null {
  if (!context?.threadId) return null;
  service.assertConversationExecution(context.threadId);
  // A thread Main minted for this unthreaded request has no conversation and therefore no prior history.
  if(mintedLocalThreads.delete(context.threadId)&&!service.getConversation(actor,context.threadId))return null;
  // The fixed assistant threads have no renderer-created conversation; Main creates it once (see ensureAssistantConversation).
  if(isAssistantThread(context.threadId)&&!service.getConversation(actor,context.threadId))service.ensureAssistantConversation(actor,context.threadId);
  const admission = assistantUserHistory.getStore();
  const mayCheckpoint = actor.requestSource === 'user' && admission?.threadId === context.threadId
    && (admission.taskId === undefined || admission.taskId === taskId);
  if (mayCheckpoint) admission.taskId = taskId;
  const read=()=>{
    const conversation=service.getConversation(actor,context.threadId!);if(!conversation)throw new Error('not_readable');
    if(service.store.db.prepare("SELECT 1 FROM source_bindings WHERE kind='cli_session' AND conversation_id=? LIMIT 1").get(conversation.id))throw new Error('cli_archive_read_only');
    const sources = conversation.taskIds.filter(id => id !== taskId), db = service.store.db;
    if ((context.taskIds ?? []).some(id => id !== taskId && !sources.includes(id))) throw new Error('not_readable');
    const unsettled = new Set<string>();
    const checkpointEvidence = [];
    let boundary = -1;
    for (const [index, sourceId] of sources.entries()) {
      service.assertTaskReadable(sourceId);
      let closureFailure: Error | undefined;
      try { service.assertHistorySourceClosed(sourceId); }
      catch (error) {
        if (!mayCheckpoint || !(error instanceof Error) || error.message !== 'blocked_unsettled') throw error;
        closureFailure = error;
      }
      if (db.prepare('SELECT task_id FROM projection_failures WHERE task_id=?').get(sourceId)) throw new Error('blocked_reconciliation');
      const binding = db.prepare('SELECT conversation_id,revoked FROM task_bindings WHERE task_id=?').get(sourceId);
      if (!binding || binding.revoked || binding.conversation_id !== conversation.id) throw new Error('not_readable');
      if (closureFailure) {
        const cursor = db.prepare(`SELECT c.source_epoch,c.event_count,c.terminal_status FROM source_cursors c
          JOIN task_presentation_sources p ON p.task_id=c.source_id AND p.source_epoch=c.source_epoch
          JOIN guarded_effect_runs g ON g.task_id=c.source_id AND g.source_epoch=c.source_epoch AND g.policy=2
          JOIN task_public_inputs i ON i.task_id=c.source_id AND i.source_kind=c.source_kind
          WHERE c.source_id=? AND c.source_kind='desktop_task'`).all(sourceId);
        const effects = db.prepare('SELECT invocation_id,tool_name FROM unproven_effects WHERE task_id=? ORDER BY invocation_id').all(sourceId);
        const toolEffects = effects.filter(row => row.invocation_id !== 'owner_inventory' || row.tool_name !== 'legacy_task_without_closure');
        if (cursor.length !== 1 || !['completed','failed','cancelled'].includes(String(cursor[0].terminal_status))
          || toolEffects.length === 0 || toolEffects.some(row => !assistantReadEffects.has(String(row.tool_name)))) throw closureFailure;
        const snapshot = inspectPriorSource?.(sourceId);
        if (!snapshot || snapshot.taskId !== sourceId || snapshot.context?.threadId !== conversation.id
          || snapshot.sessionId !== cursor[0].source_epoch || snapshot.status !== cursor[0].terminal_status
          || snapshot.events.length !== cursor[0].event_count) throw closureFailure;
        const expectedEvents = db.prepare(`SELECT sequence,event_hash FROM source_event_digests
          WHERE source_id=? AND source_epoch=? AND source_kind='desktop_task' ORDER BY sequence`).all(sourceId, snapshot.sessionId);
        if (expectedEvents.length !== snapshot.events.length
          || snapshot.events.some((event, index) => expectedEvents[index].sequence !== index || expectedEvents[index].event_hash !== digest(event))) throw closureFailure;
        const calls = snapshot.events.filter(event => event.type === 'canvas_tool_call');
        const finished = snapshot.events.filter(event => event.type === 'goal_tool_finished');
        if (calls.length === 0 || calls.length !== finished.length || new Set(calls.map(event => event.toolUseId)).size !== calls.length
          || calls.some(call => !assistantReadEffects.has(call.toolName) || !finished.some(end => end.invocationId === call.toolUseId && end.toolName === call.toolName))
          || toolEffects.some(effect => !calls.some(call => call.toolName === effect.tool_name))) throw closureFailure;
        unsettled.add(sourceId);
        checkpointEvidence.push({ sourceId, cursor: cursor[0], effects, expectedEvents });
        boundary = index;
        continue;
      }
      const coverage = db.prepare('SELECT p.source_kind,c.source_epoch,c.event_count,s.source_epoch AS settled_epoch,s.event_count AS settled_count FROM task_public_inputs p LEFT JOIN source_cursors c ON c.source_id=p.task_id AND c.source_kind=p.source_kind LEFT JOIN source_settlements s ON s.task_id=p.task_id WHERE p.task_id=?').all(sourceId);
      // Native's bounded display projection cannot claim full history before its full-source adapter exists.
      if (coverage.some(row => row.source_kind === 'native_codex')) throw new Error('source_partial');
      if (coverage.length !== 1 || coverage[0].source_epoch !== coverage[0].settled_epoch || coverage[0].event_count !== coverage[0].settled_count) throw new Error('blocked_unsettled');
    }
    const included = sources.slice(boundary + 1);
    const skipped: TaskContextSkip[] = sources.slice(0, boundary + 1).map(taskId => ({
      taskId, reason: unsettled.has(taskId) ? 'unsettled' : 'before_unsettled',
    }));
    const rows = db.prepare('SELECT v.record,a.source_id,a.execution_state FROM message_anchors a JOIN message_versions v ON v.message_id=a.id AND v.revision=a.latest_revision WHERE a.conversation_id=? AND a.deleted=0 ORDER BY a.sequence').all(conversation.id).filter(row => included.includes(String(row.source_id)));
    if (rows.some(row => row.execution_state !== 'settled')) throw new Error('blocked_unsettled');
    const history = rows.map(row => { const message = JSON.parse(String(row.record)) as ContinuityMessage; return { role: message.role === 'user' ? 'user' as const : 'assistant' as const, content: message.text }; });
    // Explicitly block instead of silently cutting mandatory constraints. P2 checkpoints own bounded omissions.
    if (Buffer.byteLength(JSON.stringify(history)) > 96 * 1024) throw new Error('context_budget_exceeded');
    return {manifest:digest([conversation,sources,included,skipped,checkpointEvidence,rows]),history,sources,included,skipped,conversationId:conversation.id};
  };
  const before=read();
  // Only the original positive dependency metadata is written. Every public
  // source/body check and the returned mandatory history follows real COMMIT.
  service.recordSourceTasks(actor,taskId,before.included);
  const current=read();if(current.manifest!==before.manifest)throw new Error('not_readable');
  return {history:current.history,audit:{threadId:current.conversationId,taskIds:current.sources,loadedTaskIds:current.included,skipped:current.skipped}};
}
