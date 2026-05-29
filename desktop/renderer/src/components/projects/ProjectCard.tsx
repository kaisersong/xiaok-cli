/**
 * ProjectCard — project summary card in the project list grid.
 * Shows name, goal, status, task progress, PO, last updated, and delete button.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, CheckCircle2, Clock, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import {
  getCompactProjectHealthLabel,
  getNormalizedProjectHealthStatus,
  shouldShowProjectHealth,
} from './kswarmStatus';
import type { ProjectFullDetail, ProjectIntervention } from '../../hooks/useKSwarmClient';

type ProjectCardHealth = Pick<
  NonNullable<ProjectFullDetail['projectHealth']>,
  'status' | 'state' | 'primaryBlockedTaskId' | 'message'
>;

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    goal?: string;
    status: string;
    taskCount?: number;
    doneCount?: number;
    stoppedCount?: number;
    plan?: { version: number };
    poAgent?: string;
    updatedAt?: number | string;
    createdAt?: number | string;
    projectHealth?: ProjectCardHealth;
    projectIntervention?: ProjectIntervention | null;
  };
}

export function ProjectCard({ project }: ProjectCardProps) {
  const navigate = useNavigate();
  const { deleteProject, agents } = useKSwarm();
  const { t } = useLocale();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
    draft: { label: t.projectsStatusDraft, color: 'text-[var(--c-text-muted)]', icon: Clock },
    planning: { label: t.projectsStatusPlanning, color: 'text-[var(--c-status-warning-text)]', icon: Loader2 },
    created: { label: t.projectsStatusPlanning, color: 'text-[var(--c-text-secondary)]', icon: Clock },
    active: { label: t.projectsStatusActive, color: 'text-[var(--c-status-success-text)]', icon: Loader2 },
    review: { label: t.projectsStatusReview, color: 'text-[var(--c-text-secondary)]', icon: Clock },
    delivered: { label: t.projectsStatusDelivered, color: 'text-[var(--c-status-success-text)]', icon: CheckCircle2 },
    closed: { label: t.projectsStatusClosed, color: 'text-[var(--c-text-muted)]', icon: CheckCircle2 },
  };

  const statusConf = STATUS_CONFIG[project.status] || STATUS_CONFIG.draft;
  const healthStatus = getNormalizedProjectHealthStatus(project.projectHealth);
  const hasHealthSignal = shouldShowProjectHealth(healthStatus);
  const hasInterventionSignal = project.projectIntervention?.required === true;
  const visibleStatus = hasInterventionSignal
    ? {
        label: '需要处理',
        color: 'text-[var(--c-status-warning-text)]',
        icon: AlertTriangle,
      }
    : hasHealthSignal
    ? {
        label: getCompactProjectHealthLabel(healthStatus),
        color: healthStatus === 'failed' || healthStatus === 'blocked'
          ? 'text-[var(--c-status-error-text)]'
          : 'text-[var(--c-status-warning-text)]',
        icon: healthStatus === 'failed' || healthStatus === 'blocked' ? AlertTriangle : Clock,
      }
    : statusConf;
  const StatusIcon = visibleStatus.icon;
  const totalTasks = project.taskCount || 0;
  const doneTasks = project.doneCount || 0;
  const stoppedTasks = project.stoppedCount || 0;
  const completedTasks = doneTasks + stoppedTasks;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const poAgentName = project.poAgent
    ? agents.find(agent => agent.id === project.poAgent)?.name || project.poAgent
    : '';

  const formatTime = (ts?: number | string) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return t.projectsCardJustNow;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}${t.projectsCardMinutesAgo}`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}${t.projectsCardHoursAgo}`;
    return d.toLocaleDateString('zh-CN');
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    try {
      await deleteProject(project.id);
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="group relative rounded-xl border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4 transition-colors hover:bg-[var(--c-bg-deep)]">
      {/* Delete button */}
      <div className={`absolute top-3 right-3 z-10 ${confirmDelete || deleting ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
        {confirmDelete ? (
          <div className="flex items-center gap-1 bg-[var(--c-bg-page)] rounded-lg border-[0.5px] border-[var(--c-status-error-text)]/30 shadow-lg px-2 py-1.5">
            <AlertTriangle size={12} className="text-[var(--c-status-error-text)]" />
            <span className="text-[10px] text-[var(--c-text-tertiary)] whitespace-nowrap">{t.projectsCardDeleteConfirm}</span>
            <button type="button" onClick={handleDelete} disabled={deleting}
              className="text-[10px] px-1.5 py-0.5 rounded font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--c-status-error-text, #ef4444)' }}>
              {deleting ? '...' : t.commonConfirm}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}
              className="text-[10px] px-1.5 py-0.5 rounded text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50">{t.commonCancel}</button>
          </div>
        ) : (
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            className="rounded-md p-1 text-[var(--c-text-muted)] hover:text-[var(--c-status-error-text)] hover:bg-[var(--c-bg-page)]" title="删除项目">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Clickable area */}
      <button type="button" onClick={() => navigate(`/projects/${project.id}`)}
        className="text-left w-full pr-16"
      >
        <div className="flex items-start gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--c-bg-deep)]">
            <FolderKanban size={16} className="text-[var(--c-text-icon)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-medium text-[var(--c-text-primary)] truncate">{project.name}</h3>
              <span className={`shrink-0 text-[10px] ${visibleStatus.color}`}>
                <StatusIcon size={10} className="inline" /> {visibleStatus.label}
              </span>
            </div>
          </div>
        </div>

        {project.goal && <p className="text-xs text-[var(--c-text-tertiary)] mt-2 line-clamp-2">{project.goal}</p>}
        {hasInterventionSignal && project.projectIntervention?.message && (
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--c-status-warning-text)] line-clamp-2">
            {project.projectIntervention.message}
          </p>
        )}
        {!hasInterventionSignal && hasHealthSignal && project.projectHealth?.message && (
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--c-status-error-text)] line-clamp-2">
            {project.projectHealth.message}
          </p>
        )}

        {totalTasks > 0 && (
          <div className="flex flex-col gap-1.5 mt-3">
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--c-bg-deep)]">
              <div className="h-full rounded-full bg-[var(--c-status-success-text)] transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--c-text-muted)]">
              <span>{stoppedTasks > 0 ? `${doneTasks} 完成 · ${stoppedTasks} 停止` : `${doneTasks}/${totalTasks} 任务`}</span>
              <span>{progress}%</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mt-3 text-[10px] text-[var(--c-text-muted)]">
          <div className="flex items-center gap-2">
            {poAgentName && <span>PO: {poAgentName}</span>}
            {project.plan && (
              <span className="rounded bg-[var(--c-bg-deep)] px-1.5 py-0.5 text-[9px]">
                Plan v{project.plan.version}
              </span>
            )}
          </div>
          {(project.updatedAt || project.createdAt) && <span>{formatTime(project.updatedAt || project.createdAt)}</span>}
        </div>
      </button>
    </div>
  );
}
