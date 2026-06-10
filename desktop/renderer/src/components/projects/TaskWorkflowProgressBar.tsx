import type { TaskPipelineProgress } from './workflowUtils';

interface TaskWorkflowProgressBarProps {
  progress: TaskPipelineProgress;
  height?: 'sm' | 'md';
}

export function TaskWorkflowProgressBar({ progress, height = 'sm' }: TaskWorkflowProgressBarProps) {
  if (progress.total === 0) return null;

  const completedPct = (progress.completed / progress.total) * 100;
  const runningPct = (progress.running / progress.total) * 100;
  const failedPct = (progress.failed / progress.total) * 100;
  const barHeight = height === 'md' ? 'h-1.5' : 'h-1';

  return (
    <div className="flex flex-col gap-1">
      <div className={`${barHeight} w-full overflow-hidden rounded-full bg-[var(--c-bg-deep)]`}>
        <div className="flex h-full">
          {completedPct > 0 && (
            <div
              className="h-full bg-[var(--c-status-success-text)] transition-all duration-300"
              style={{ width: `${completedPct}%` }}
            />
          )}
          {runningPct > 0 && (
            <div
              className="h-full animate-pulse bg-[var(--c-accent)] transition-all duration-300"
              style={{ width: `${runningPct}%` }}
            />
          )}
          {failedPct > 0 && (
            <div
              className="h-full bg-[var(--c-status-error-text)] transition-all duration-300"
              style={{ width: `${failedPct}%` }}
            />
          )}
        </div>
      </div>
      <span className="truncate text-[10px] leading-none text-[var(--c-text-muted)]">
        {progress.primaryMessage || `${progress.completed}/${progress.total} 节点`}
      </span>
    </div>
  );
}
