import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';

export function Sidebar() {
  const navigate = useNavigate();

  return (
    <aside className="flex w-64 flex-col border-r border-[var(--c-border)] bg-[var(--c-bg-sidebar)]">
      <div className="p-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-[var(--c-bg-card)]"
        >
          <Plus className="size-4" />
          <span>New</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <p className="text-sm text-[var(--c-text-secondary)]">No tasks yet</p>
      </div>
    </aside>
  );
}
