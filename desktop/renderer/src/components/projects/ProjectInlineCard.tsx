import { useNavigate } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import type { KSwarmProject, KSwarmProjectExecutionMode, KSwarmWorkflowRun } from '../../hooks/useKSwarmClient';

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
  });

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
        <span>{displayMemberCount} 个智能体</span>
        <span>·</span>
        <span>{statusText}</span>
      </div>
    </button>
  );
}

export function getInlineProjectStatusText(input: {
  status: string;
  executionMode?: KSwarmProjectExecutionMode | 'workflow' | string;
  latestWorkflowRun?: KSwarmProject['latestWorkflowRun'] | KSwarmWorkflowRun | null;
}): string {
  const executionMode = normalizeInlineExecutionMode(input.executionMode);
  const workflowStatus = input.latestWorkflowRun?.status;
  if (executionMode === 'workflow_preferred') {
    if (workflowStatus === 'running') return 'Workflow 运行中';
    if (workflowStatus === 'completed') return 'Workflow 已完成';
    if (workflowStatus === 'blocked') return 'Workflow 阻塞';
    if (workflowStatus === 'failed') return 'Workflow 失败';
    return '工作流执行';
  }
  return input.status === 'created' ? 'PO 正在分解...' : input.status;
}

function normalizeInlineExecutionMode(mode?: KSwarmProjectExecutionMode | 'workflow' | string): KSwarmProjectExecutionMode | undefined {
  if (mode === 'workflow') return 'workflow_preferred';
  if (mode === 'workflow_preferred' || mode === 'auto' || mode === 'direct') return mode;
  return undefined;
}
