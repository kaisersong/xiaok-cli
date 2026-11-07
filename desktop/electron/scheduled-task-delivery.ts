import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
import type {TimedActionStore} from './timed-action-store.js';
import type {ScheduledTaskDueEvent} from '../shared/scheduled-task-due-event.js';

type Snapshot = Pick<TaskSnapshot, 'status'> & Partial<Pick<TaskSnapshot, 'hostDelivery' | 'result' | 'events'>>;
/** Runs inside the existing scheduler tick; reads persisted execution facts only. */
export function createScheduledTaskDeliveryReconciler(options: {
  store: Pick<TimedActionStore, 'listPendingScheduledDeliveries' | 'acknowledgeScheduledDelivery'>;
  readSnapshot: (taskId: string) => Promise<Snapshot | null | undefined>;
  publish: (event: ScheduledTaskDueEvent) => boolean;
  now?: () => number;
  onError?: (error: unknown) => void;
}): (signal?: AbortSignal) => Promise<void> {
  return async signal => {
    for (const {action, run} of options.store.listPendingScheduledDeliveries()) {
      if (signal?.aborted) return;
      try {
        const snapshot = await options.readSnapshot(run.runtimeTaskId!);
        if (signal?.aborted) return;
        if (!snapshot || !['completed', 'failed', 'cancelled'].includes(snapshot.status)) continue;
        const delivery = snapshot.hostDelivery;
        if (delivery?.status === 'checking' || delivery?.verification === 'pending'
          || delivery?.hostSettlement === 'pending') continue;
        const success = snapshot.status === 'completed'
          && (!delivery || delivery.status === 'passed' && delivery.hostSettlement === 'committed');
        const runtimeState = success ? 'completed' : snapshot.status === 'cancelled' ? 'cancelled' : 'failed';
        const errorEvent = [...(snapshot.events ?? [])].reverse().find(event => event.type === 'error');
        const error = success ? undefined : errorEvent?.type === 'error' ? errorEvent.message
          : delivery?.guardFailure?.code ?? (runtimeState === 'cancelled' ? 'task_cancelled' : 'task_execution_failed');
        const event: ScheduledTaskDueEvent = {
          taskId: action.id, runId: run.runId, runtimeTaskId: run.runtimeTaskId,
          title: action.title, completed: true, success, runtimeState, dispatchStatus: 'success',
          lastRunAt: run.startedAt, nextRunAt: action.nextDueAt, error,
        };
        if (options.publish(event)) {
          options.store.acknowledgeScheduledDelivery(run.runId, (options.now ?? Date.now)(), event);
        }
      } catch (error) { options.onError?.(error); }
    }
  };
}
