import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import { useKSwarm } from '../../contexts/KSwarmContext';
import type { KSwarmProjectExecutionMode } from '../../hooks/useKSwarmClient';
import { getInlineProjectStatusText, buildInlineProjectLabels, normalizeInlineExecutionMode } from './project-inline-utils';

interface ProjectInlineCardProps {
  projectId: string;
  name: string;
  goal: string;
  status: string;
  createdAt: number;
  memberCount: number;
  executionMode?: KSwarmProjectExecutionMode | 'workflow' | string;
}

export function ProjectInlineCard({ projectId, name, goal, status, createdAt, memberCount, executionMode }: ProjectInlineCardProps) {
  const navigate = useNavigate();
  const { t } = useLocale();
  const inlineLabels = useMemo(() => buildInlineProjectLabels(t), [t]);
  const { projects } = useKSwarm();
  const liveProject = projects.find(project => project.id === projectId);
  const displayName = liveProject?.name || name;
  const displayGoal = liveProject?.goal || goal;
  const displayStatus = liveProject?.status || status;
  const displayMemberCount = liveProject?.members?.length ?? memberCount;
  const displayExecutionMode = liveProject?.executionMode || normalizeInlineExecutionMode(executionMode);
  const statusText = getInlineProjectStatusText({
    status: displayStatus,
    executionMode: displayExecutionMode,
    latestWorkflowRun: liveProject?.latestWorkflowRun || null,
  }, inlineLabels);

  return (
    <button
      type="button"
      aria-label={displayName}
      onClick={() => navigate(`/projects/${projectId}`)}
      className="cursor-pointer rounded-xl border border-[var(--c-border-subtle)]
                 bg-[var(--c-bg-card)] p-4 hover:bg-[var(--c-bg-deep)]
                 transition-colors duration-150 max-w-md text-left"
    >
      <div className="flex items-center gap-2 mb-1">
        <FolderKanban size={16} className="text-[var(--c-text-secondary)]" />
        <span className="text-sm font-medium text-[var(--c-text-heading)]">{displayName}</span>
      </div>
      <div className="text-xs text-[var(--c-text-secondary)] mb-2 line-clamp-2">
        {displayGoal}
      </div>
      <div className="flex items-center gap-3 text-xs text-[var(--c-text-muted)]">
        <span>{t.projectsInlineAgentCount(displayMemberCount)}</span>
        <span>·</span>
        <span>{statusText}</span>
      </div>
    </button>
  );
}
