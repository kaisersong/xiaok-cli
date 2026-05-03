import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Star, Trash2, FolderOpen } from 'lucide-react';
import { api, type ThreadRecord } from '../api';
import type { ThreadGtdBucket } from '../api/types';

const GTD_BUCKETS: Array<{ bucket: ThreadGtdBucket | null; label: string; icon: React.ReactNode }> = [
  { bucket: 'inbox', label: 'Inbox', icon: <FolderOpen className="size-4" /> },
  { bucket: 'todo', label: 'Todo', icon: <FolderOpen className="size-4" /> },
  { bucket: null, label: 'Archived', icon: <Trash2 className="size-4" /> },
];

export function Sidebar() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [activeBucket, setActiveBucket] = useState<ThreadGtdBucket | null>('inbox');

  useEffect(() => {
    api.listThreads().then(setThreads);
  }, []);

  const filteredThreads = threads.filter(t => t.gtdBucket === activeBucket);
  const starredThreads = threads.filter(t => t.starred);

  const handleNewThread = () => {
    navigate('/');
  };

  const handleSelectThread = (threadId: string) => {
    navigate(`/t/${threadId}`);
  };

  const handleDeleteThread = async (threadId: string) => {
    await api.deleteThread(threadId);
    setThreads(prev => prev.filter(t => t.id !== threadId));
  };

  const handleToggleStar = async (threadId: string) => {
    const thread = threads.find(t => t.id === threadId);
    if (thread?.starred) {
      await api.unstarThread(threadId);
    } else {
      await api.starThread(threadId);
    }
    const updated = await api.listThreads();
    setThreads(updated);
  };

  return (
    <aside className="flex w-64 flex-col border-r border-[var(--c-border)] bg-[var(--c-bg-sidebar)]">
      <div className="flex items-center justify-between p-3">
        <button type="button" onClick={handleNewThread} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-[var(--c-bg-card)]">
          <Plus className="size-4" />
          <span>New</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {starredThreads.length > 0 && (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-[var(--c-text-secondary)]">
              <Star className="size-3" />
              <span>Starred</span>
            </div>
            {starredThreads.map(thread => (
              <button
                key={thread.id}
                type="button"
                onClick={() => handleSelectThread(thread.id)}
                className="w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-[var(--c-bg-card)]"
              >
                {thread.title || 'Untitled'}
              </button>
            ))}
          </div>
        )}

        {GTD_BUCKETS.map(({ bucket, label, icon }) => (
          <div key={bucket ?? 'archived'} className="px-3 py-2">
            <button
              type="button"
              onClick={() => setActiveBucket(bucket)}
              className={`flex items-center gap-2 text-xs ${activeBucket === bucket ? 'text-[var(--c-accent)]' : 'text-[var(--c-text-secondary)]'}`}
            >
              {icon}
              <span>{label}</span>
            </button>
            {filteredThreads.filter(t => t.gtdBucket === bucket).map(thread => (
              <div key={thread.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => handleToggleStar(thread.id)}
                  className="p-1 text-[var(--c-text-secondary)]"
                >
                  <Star className={`size-3 ${thread.starred ? 'fill-yellow-400 text-yellow-400' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectThread(thread.id)}
                  className="flex-1 truncate rounded px-2 py-1 text-left text-sm hover:bg-[var(--c-bg-card)]"
                >
                  {thread.title || 'Untitled'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteThread(thread.id)}
                  className="hidden group-hover:block p-1 text-[var(--c-text-secondary)] hover:text-red-500"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--c-border)] p-3">
        <div className="text-xs text-[var(--c-text-secondary)]">local@xiaok</div>
      </div>
    </aside>
  );
}