import type { TaskSnapshot } from '../../../shared/task-types';
import type { TaskHistoryRead, TaskPublicPresentation } from '../../../shared/task-history';
import type {LocalLegacyTaskArchive} from '../../../shared/local-legacy-task-archive';

interface DisplayRecoveryPort {
  recoverTask(taskId: string, legacyPrompt?: string): Promise<{ snapshot: TaskSnapshot; recoveredFromTaskId?: string }>;
  readTaskHistory?(taskId: string): Promise<TaskHistoryRead>;
  hasTaskHistoryPresentation?(): boolean;
  readLocalLegacyTaskArchive?(taskId:string):Promise<LocalLegacyTaskArchive>;
  hasLocalLegacyTaskArchive?():boolean;
}

function canDisplayCompletedHistory(history: TaskHistoryRead, taskId: string, threadId: string): boolean {
  const { snapshot, presentation } = history;
  return snapshot.taskId === taskId && snapshot.context?.threadId === threadId
    && snapshot.status === 'completed' && !snapshot.executionScope && !snapshot.inputPreparation
    && !snapshot.executionProtected && !snapshot.protectedObservationClosure
    && presentation?.version === 1 && presentation.taskId === taskId && presentation.sourceEpoch === snapshot.sessionId
    && !snapshot.events.some(event => (event.type === 'canvas_tool_call' || event.type === 'canvas_tool_result')
      && ['create_project', 'get_dynamic_workflow_status'].includes(event.toolName.trim().toLowerCase()));
}

/** Existing workflow cards retain their owner; a Task proof never certifies them. */
export async function recoverForDisplay(port: DisplayRecoveryPort, taskId: string, legacyPrompt: string | undefined,
  current: () => boolean, legacyDisplay = false, canonicalThreadId?: string): Promise<{ snapshot: TaskSnapshot; presentation?: TaskPublicPresentation | null; recoveredFromTaskId?: string;archive?:LocalLegacyTaskArchive }> {
  const available = port.hasTaskHistoryPresentation ? port.hasTaskHistoryPresentation() : typeof port.readTaskHistory === 'function';
  if (canonicalThreadId && !legacyDisplay && available) {
    if (typeof port.readTaskHistory !== 'function') throw new Error('task_history_unavailable');
    const history = await port.readTaskHistory(taskId);
    if (!current()) throw new Error('stale_task_history');
    if (canDisplayCompletedHistory(history, taskId, canonicalThreadId)) return history;
  }
  const recovered = await port.recoverTask(taskId, legacyPrompt);
  if (!current()) throw new Error('stale_task_history');
  const localArchive=port.hasLocalLegacyTaskArchive?port.hasLocalLegacyTaskArchive():typeof port.readLocalLegacyTaskArchive==='function';
  if((!recovered.snapshot.context||legacyDisplay)&&!recovered.snapshot.executionScope&&!recovered.snapshot.inputPreparation&&localArchive===true){
    if(typeof port.readLocalLegacyTaskArchive!=='function')throw Error('local_legacy_archive_unavailable');
    const archive=await port.readLocalLegacyTaskArchive(recovered.snapshot.taskId);
    if(!current())throw Error('stale_task_history');
    if(archive.taskId!==recovered.snapshot.taskId||archive.sourceEpoch!==recovered.snapshot.sessionId)throw Error('local_legacy_archive_unavailable');
    return {...recovered,presentation:null,archive};
  }
  if (available !== true) {
    // Explicit older API capability only. A rejected new API cannot reach here.
    return { ...recovered, ...(recovered.snapshot.executionScope?.kind === 'goal_turn' ? { presentation: null } : {}) };
  }
  if (typeof port.readTaskHistory !== 'function') throw new Error('task_history_unavailable');
  const history = await port.readTaskHistory(recovered.snapshot.taskId);
  if (!current()) throw new Error('stale_task_history');
  const before = recovered.snapshot, actual = history.snapshot;
  if (!actual || actual.taskId !== before.taskId || actual.sessionId !== before.sessionId || actual.prompt !== before.prompt
    || JSON.stringify(actual.executionScope ?? null) !== JSON.stringify(before.executionScope ?? null)
    || history.presentation && (history.presentation.version !== 1 || history.presentation.taskId !== actual.taskId
      || history.presentation.sourceEpoch !== actual.sessionId)) throw new Error('task_history_unavailable');
  return { ...recovered, snapshot: actual.executionScope?.kind === 'goal_turn' ? actual : before,
    presentation: history.presentation };
}
