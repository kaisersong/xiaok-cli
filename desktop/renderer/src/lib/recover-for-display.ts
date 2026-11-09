import type { TaskSnapshot } from '../../../shared/task-types';
import type { TaskHistoryRead, TaskPublicPresentation } from '../../../shared/task-history';

interface DisplayRecoveryPort {
  recoverTask(taskId: string, legacyPrompt?: string): Promise<{ snapshot: TaskSnapshot; recoveredFromTaskId?: string }>;
  readTaskHistory?(taskId: string): Promise<TaskHistoryRead>;
  hasTaskHistoryPresentation?(): boolean;
}

/** Existing workflow cards retain their owner; a Task proof never certifies them. */
export async function recoverForDisplay(port: DisplayRecoveryPort, taskId: string, legacyPrompt: string | undefined,
  current: () => boolean): Promise<{ snapshot: TaskSnapshot; presentation?: TaskPublicPresentation | null; recoveredFromTaskId?: string }> {
  const recovered = await port.recoverTask(taskId, legacyPrompt);
  if (!current()) throw new Error('stale_task_history');
  const available = port.hasTaskHistoryPresentation ? port.hasTaskHistoryPresentation() : typeof port.readTaskHistory === 'function';
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
