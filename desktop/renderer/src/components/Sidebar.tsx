import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, X } from 'lucide-react';
import { api, type ThreadRecord } from '../api';

export function Sidebar() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listThreads({ limit: 50 }).then(setThreads);
  }, []);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  const filteredThreads = searchQuery
    ? threads.filter(t => t.title?.toLowerCase().includes(searchQuery.toLowerCase()))
    : threads;

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await api.deleteThread(id);
    setThreads(prev => prev.filter(t => t.id !== id));
  };

  const handleDoubleClick = (thread: ThreadRecord) => {
    setEditingId(thread.id);
    setEditTitle(thread.title || '');
  };

  const handleRenameSubmit = async () => {
    if (editingId && editTitle.trim()) {
      await api.updateThreadTitle(editingId, editTitle.trim());
      setThreads(prev =>
        prev.map(t => t.id === editingId ? { ...t, title: editTitle.trim() } : t)
      );
    }
    setEditingId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameSubmit();
    if (e.key === 'Escape') setEditingId(null);
  };

  return (
    <aside className="flex w-64 flex-col border-r border-[var(--c-border)] bg-[var(--c-bg-sidebar)]">
      {/* Header */}
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

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5">
          <Search className="size-3.5 text-[var(--c-text-secondary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--c-text-secondary)]"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className="text-[var(--c-text-secondary)]">
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-3">
        {filteredThreads.length === 0 && (
          <p className="py-4 text-center text-sm text-[var(--c-text-secondary)]">
            {searchQuery ? 'No results' : 'No tasks yet'}
          </p>
        )}
        {filteredThreads.map(thread => (
          <div
            key={thread.id}
            className="group flex items-center rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--c-bg-card)]"
            onClick={() => navigate(`/t/${thread.id}`)}
            onDoubleClick={() => handleDoubleClick(thread)}
            role="button"
            tabIndex={0}
          >
            {editingId === thread.id ? (
              <input
                ref={editRef}
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={handleRenameKeyDown}
                className="flex-1 rounded border border-[var(--c-accent)] bg-transparent px-1 text-sm outline-none"
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className="flex-1 truncate">{thread.title || 'Untitled'}</span>
            )}
            <button
              type="button"
              onClick={e => handleDelete(e, thread.id)}
              className="ml-1 hidden shrink-0 p-0.5 text-[var(--c-text-secondary)] hover:text-red-500 group-hover:block"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--c-border)] p-3">
        <div className="text-xs text-[var(--c-text-secondary)]">local@xiaok</div>
      </div>
    </aside>
  );
}
