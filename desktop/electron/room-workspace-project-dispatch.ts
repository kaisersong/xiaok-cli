import { randomUUID } from 'node:crypto';

/** The existing user dispatch button, backed by KSwarm's authoritative plan.
 * No main-side task invention, readiness heuristic, or legacy fallback on error.
 */
export function createRoomWorkspaceProjectDispatch(options: {
  adapter: { listDispatchCandidates(projectId: string): Promise<{ roomId: string; tasks: Array<{ taskId: string; logicalAgentId: string }> } | null> };
  runtime: { prepareProjectTask(input: { roomId: string; projectId: string; taskId: string; logicalAgentId: string; requestId: string }): Promise<unknown> };
}) {
  const pending = new Map<string, Promise<Record<string, unknown> | null>>();
  return function dispatch(projectId: string, _body?: unknown): Promise<Record<string, unknown> | null> {
    const active = pending.get(projectId);
    if (active) return active;
    const work = (async () => {
      const plan = await options.adapter.listDispatchCandidates(projectId);
      if (!plan) return null;
      const batchId = randomUUID();
      const outcomes = await Promise.all(plan.tasks.map(async task => {
        try {
          await options.runtime.prepareProjectTask({ roomId: plan.roomId, projectId, ...task, requestId: `${batchId}:${task.taskId}` });
          return { taskId: task.taskId, ok: true as const };
        } catch (error) { return { taskId: task.taskId, ok: false as const, code: error instanceof Error ? error.message : 'workspace_dispatch_pending' }; }
      }));
      const failed = outcomes.filter(item => !item.ok).map(({ taskId, code }) => ({ taskId, code }));
      return { ok: failed.length === 0, dispatched: outcomes.filter(item => item.ok).map(item => item.taskId), failed, blocked: failed, skipped: [] };
    })().finally(() => { if (pending.get(projectId) === work) pending.delete(projectId); });
    pending.set(projectId, work);
    return work;
  };
}
