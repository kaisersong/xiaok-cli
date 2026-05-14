import { useNavigate } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';

interface ProjectInlineCardProps {
  projectId: string;
  name: string;
  status: string;
  createdAt: number;
  memberCount: number;
}

export function ProjectInlineCard({ projectId, name, status, createdAt, memberCount }: ProjectInlineCardProps) {
  const navigate = useNavigate();
  const statusText = status === 'created' ? 'PO 正在分解...' : status;

  return (
    <div
      onClick={() => navigate(`/projects/${projectId}`)}
      className="cursor-pointer rounded-xl border border-[var(--c-border-subtle)]
                 bg-[var(--c-bg-card)] p-4 hover:bg-[var(--c-bg-deep)]
                 transition-colors duration-150 max-w-md"
    >
      <div className="flex items-center gap-2 mb-2">
        <FolderKanban size={16} className="text-[var(--c-text-secondary)]" />
        <span className="text-sm font-medium text-[var(--c-text-heading)]">{name}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-[var(--c-text-muted)]">
        <span>{memberCount} 个智能体</span>
        <span>·</span>
        <span>{statusText}</span>
      </div>
    </div>
  );
}
