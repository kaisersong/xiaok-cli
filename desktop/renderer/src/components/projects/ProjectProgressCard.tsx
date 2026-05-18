/**
 * ProjectProgressCard — inline card shown in chat when a project is referenced.
 */

import { useNavigate } from 'react-router-dom';
import { FolderKanban, ArrowRight } from 'lucide-react';
import { getCompactProjectHealthLabel, shouldShowProjectHealth, type ProjectHealthStatus } from './kswarmStatus';

interface ProjectProgressCardProps {
  project: {
    id: string;
    name: string;
    status: string;
    taskCount?: number;
    doneCount?: number;
    cancelledCount?: number;
    dispatchPlan?: {
      dispatchable?: Array<{ taskId: string; agentId?: string; reason?: string }>;
      blocked?: Array<{ taskId: string; reason: string; blockedByTaskId?: string }>;
      waiting?: Array<{ taskId: string; reason: string; agentId?: string }>;
    };
    projectHealth?: {
      status: ProjectHealthStatus;
      message?: string;
    };
  };
}

export function ProjectProgressCard({ project }: ProjectProgressCardProps) {
  const navigate = useNavigate();
  const totalTasks = project.taskCount || 0;
  const doneTasks = project.doneCount || 0;
  const cancelledTasks = project.cancelledCount || 0;
  const completedTasks = doneTasks + cancelledTasks;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const statusLabels: Record<string, string> = {
    draft: '草稿', planning: '规划中', created: '已创建',
    active: '进行中', review: '审核中', delivered: '已交付', closed: '已关闭',
  };
  const healthStatus = project.projectHealth?.status ?? 'unknown';
  const hasHealthSignal = shouldShowProjectHealth(healthStatus);
  const dispatchableCount = project.dispatchPlan?.dispatchable?.length ?? 0;
  const blockedCount = project.dispatchPlan?.blocked?.length ?? 0;
  const waitingCount = project.dispatchPlan?.waiting?.length ?? 0;

  return (
    <div
      className="my-2 flex cursor-pointer items-center gap-3 rounded-xl border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4 transition-colors duration-150 hover:bg-[var(--c-bg-deep)]"
      onClick={() => navigate(`/projects/${project.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') navigate(`/projects/${project.id}`); }}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--c-bg-deep)]">
        <FolderKanban size={16} className="text-[var(--c-text-icon)]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium text-[var(--c-text-primary)] truncate">{project.name}</p>
          <span className="shrink-0 rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[10px] text-[var(--c-text-muted)]">
            {hasHealthSignal ? getCompactProjectHealthLabel(healthStatus) : (statusLabels[project.status] || project.status)}
          </span>
        </div>
        {hasHealthSignal && project.projectHealth?.message && (
          <p className="mt-1 text-[11px] text-[var(--c-text-secondary)] truncate">{project.projectHealth.message}</p>
        )}
        {totalTasks > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--c-bg-deep)]">
              <div className="h-full rounded-full bg-[var(--c-status-success-text)] transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="shrink-0 text-[10px] text-[var(--c-text-muted)]">{cancelledTasks > 0 ? `${doneTasks} 完成 · ${cancelledTasks} 取消` : `${doneTasks}/${totalTasks}`}</span>
          </div>
        )}
        {(dispatchableCount > 0 || blockedCount > 0 || waitingCount > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-[var(--c-text-muted)]">
            <span>可派发 {dispatchableCount}</span>
            <span>阻塞 {blockedCount}</span>
            <span>等待 {waitingCount}</span>
          </div>
        )}
      </div>
      <ArrowRight size={14} className="shrink-0 text-[var(--c-text-muted)]" />
    </div>
  );
}
