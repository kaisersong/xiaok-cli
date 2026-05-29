import { useNavigate } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';

interface ProjectInlineCardProps {
  projectId: string;
  name: string;
  goal: string;
  status: string;
  createdAt: number;
  memberCount: number;
}

export function ProjectInlineCard({ projectId, name, goal, status, createdAt, memberCount }: ProjectInlineCardProps) {
  const navigate = useNavigate();
  const statusText = status === 'created' ? 'PO 正在分解...' : status;

  return (
    <button
      type="button"
      aria-label={name}
      onClick={() => navigate(`/projects/${projectId}`)}
      className="cursor-pointer rounded-xl border border-[var(--c-border-subtle)]
                 bg-[var(--c-bg-card)] p-4 hover:bg-[var(--c-bg-deep)]
                 transition-colors duration-150 max-w-md text-left"
    >
      <div className="flex items-center gap-2 mb-1">
        <FolderKanban size={16} className="text-[var(--c-text-secondary)]" />
        <span className="text-sm font-medium text-[var(--c-text-heading)]">{name}</span>
      </div>
      <div className="text-xs text-[var(--c-text-secondary)] mb-2 line-clamp-2">
        {goal}
      </div>
      <div className="flex items-center gap-3 text-xs text-[var(--c-text-muted)]">
        <span>{memberCount} 个智能体</span>
        <span>·</span>
        <span>{statusText}</span>
      </div>
    </button>
  );
}
