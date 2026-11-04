/** Main-owned dispatch/execution notification; dispatch success is never completion. */
export interface ScheduledTaskDueEvent {
  taskId: string;
  runId?: string;
  runtimeTaskId?: string;
  completed?: boolean;
  dispatchStatus?: 'success' | 'failed' | 'skipped';
  runtimeState?: 'accepted' | 'not_started' | 'completed' | 'failed' | 'cancelled';
  success?: boolean;
  title?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  error?: string;
}
