import { useState, useEffect, useRef } from 'react';
import { createLogger } from '../lib/logger';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Search, X, Bolt, Pencil, Download, RefreshCw, Clock, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { api, type ThreadRecord } from '../api';

const log = createLogger('Sidebar');

interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  progress: number;
  version?: string;
  error?: string;
}

interface SidebarScheduledTask {
  id: string;
  name: string;
  frequency: string;
  threadId?: string;
}

type NavSection = 'new' | 'scheduled';

interface SidebarProps {
  onOpenSettings?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ onOpenSettings, collapsed, onToggleCollapse }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const editRef = useRef<HTMLInputElement>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [activeNav, setActiveNav] = useState<NavSection>('new');
  const [sidebarTasks, setSidebarTasks] = useState<SidebarScheduledTask[]>([]);
  const [scheduledThreadIds, setScheduledThreadIds] = useState<Set<string>>(new Set());

  // Load threads
  useEffect(() => {
    const load = () => api.listThreads({ limit: 50 }).then(setThreads);
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, []);

  // Load scheduled tasks for sidebar
  useEffect(() => {
    const loadScheduled = () => {
      try {
        const raw = localStorage.getItem('xiaok:scheduled-tasks');
        const items = raw ? JSON.parse(raw) : [];
        setSidebarTasks(items.map((t: any) => ({
          id: t.id,
          name: t.name,
          frequency: t.frequency,
          threadId: t.threadId,
        })));
        // Collect all scheduled thread IDs to exclude from history
        const threadIds = new Set<string>();
        for (const t of items) {
          if (t.threadId) threadIds.add(t.threadId);
        }
        setScheduledThreadIds(threadIds);
      } catch { /* ignore */ }
    };
    loadScheduled();
  }, []);

  // Listen for scheduled task updates
  useEffect(() => {
    const handler = () => {
      try {
        const raw = localStorage.getItem('xiaok:scheduled-tasks');
        const items = raw ? JSON.parse(raw) : [];
        setSidebarTasks(items.map((t: any) => ({
          id: t.id,
          name: t.name,
          frequency: t.frequency,
          threadId: t.threadId,
        })));
        const threadIds = new Set<string>();
        for (const t of items) {
          if (t.threadId) threadIds.add(t.threadId);
        }
        setScheduledThreadIds(threadIds);
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', (e) => {
      if (e.key === 'xiaok:scheduled-tasks') handler();
    });
    // Also listen for custom event
    window.addEventListener('xiaok:scheduled-tasks-updated', handler);
    return () => {
      window.removeEventListener('storage', () => {});
      window.removeEventListener('xiaok:scheduled-tasks-updated', handler);
    };
  }, []);

  // Subscribe to update status
  useEffect(() => {
    const unsub = api.onUpdateStatus(setUpdateStatus);
    api.getUpdateStatus().then(setUpdateStatus).catch(() => {});
    return unsub;
  }, []);

  // Sync activeNav with route
  useEffect(() => {
    if (location.pathname === '/scheduled') {
      setActiveNav('scheduled');
    } else {
      setActiveNav('new');
    }
  }, [location.pathname]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  const filteredThreads = (searchQuery
    ? threads.filter(t => t.title?.toLowerCase().includes(searchQuery.toLowerCase()))
    : threads
  ).filter(t => !scheduledThreadIds.has(t.id));

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    log.info('deleteThread', id);
    await api.deleteThread(id);
    setThreads(prev => prev.filter(t => t.id !== id));
    log.info('deleteThread ok');
  };

  const handleDoubleClick = (thread: ThreadRecord) => {
    setEditingId(thread.id);
    setEditTitle(thread.title || '');
  };

  const handleRenameSubmit = async () => {
    if (editingId && editTitle.trim()) {
      log.info('renameThread', JSON.stringify({ id: editingId, newTitle: editTitle.trim() }));
      await api.updateThreadTitle(editingId, editTitle.trim());
      log.info('renameThread ok');
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

  const handleScheduledClick = (task: SidebarScheduledTask) => {
    if (task.threadId) {
      navigate(`/t/${task.threadId}`);
    } else {
      navigate('/scheduled');
    }
  };

  const isOnScheduled = activeNav === 'scheduled';

  return (
    <aside
      className="relative flex flex-col border-r border-[var(--c-border)] bg-[var(--c-bg-sidebar)] transition-[width] duration-200"
      style={{ width: collapsed ? 52 : 240, paddingTop: 28 }}
    >
      {/* Collapse toggle at top - positioned for macOS traffic lights */}
      <div className="absolute top-3 flex items-center justify-end" style={{ width: collapsed ? 52 : 240, paddingRight: collapsed ? 8 : 12 }}>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-7 w-7 items-center justify-center rounded text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors"
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Main navigation */}
      <div className="px-2">
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => navigate('/')}
            className={`flex h-[36px] items-center gap-2.5 rounded-lg text-sm transition-colors ${
              activeNav === 'new'
                ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-primary)]'
                : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]'
            }`}
            style={{ padding: collapsed ? '0 0 0 14px' : '0 12px' }}
            title="New task"
          >
            <Plus size={16} className="shrink-0" />
            {!collapsed && <span>New task</span>}
          </button>
          <button
            type="button"
            onClick={() => navigate('/scheduled')}
            className={`flex h-[36px] items-center gap-2.5 rounded-lg text-sm transition-colors ${
              isOnScheduled
                ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-primary)]'
                : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]'
            }`}
            style={{ padding: collapsed ? '0 0 0 14px' : '0 12px' }}
            title="Scheduled"
          >
            <Clock size={16} className="shrink-0" />
            {!collapsed && <span>Scheduled</span>}
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="px-4">
        <div className="h-px bg-[var(--c-border)]" />
      </div>

      {/* Scheduled tasks list (Claude-style) */}
      {sidebarTasks.length > 0 && (
        <div className="px-3 py-2">
          <div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--c-text-tertiary)]">
            Scheduled
          </div>
          <div className="flex flex-col gap-0">
            {sidebarTasks.map(task => (
              <button
                key={task.id}
                type="button"
                onClick={() => handleScheduledClick(task)}
                className="flex items-center justify-between rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-card)] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-1.5 w-1.5 rounded-full bg-[var(--c-accent)]/40 shrink-0" />
                  <span className="truncate">{task.name}</span>
                </div>
                <span className="shrink-0 text-[var(--c-text-tertiary)] ml-2">{task.frequency}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Divider before thread list */}
      {!collapsed && !isOnScheduled && (
        <>
          {/* Search */}
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5">
              <Search className="size-3.5 text-[var(--c-text-secondary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索..."
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
          <div className="flex-1 overflow-y-auto px-3 py-1">
            <div className="py-1 text-xs font-medium text-[var(--c-text-secondary)]">
              历史任务
            </div>
            {filteredThreads.length === 0 && (
              <p className="py-3 text-center text-xs text-[var(--c-text-secondary)]">
                {searchQuery ? '无结果' : '暂无历史任务'}
              </p>
            )}
            {filteredThreads.map(thread => (
              <div
                key={thread.id}
                className="group flex cursor-pointer items-center rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--c-bg-card)]"
                onClick={() => navigate(`/t/${thread.id}`)}
                onKeyDown={e => { if (e.key === 'Enter') navigate(`/t/${thread.id}`); }}
                role="button"
                tabIndex={0}
                data-testid={`thread-item-${thread.id}`}
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
                  <span className="flex-1 truncate">{thread.title || '未命名'}</span>
                )}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    handleDoubleClick(thread);
                  }}
                  className="ml-1 hidden shrink-0 p-0.5 text-[var(--c-text-secondary)] hover:text-[var(--c-accent)] group-hover:block"
                  title="重命名"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={e => handleDelete(e, thread.id)}
                  className="ml-0.5 hidden shrink-0 p-0.5 text-[var(--c-text-secondary)] hover:text-red-500 group-hover:block"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Spacer for scheduled page view */}
      {(isOnScheduled || collapsed) && <div className="flex-1" />}

      {/* Footer with settings button */}
      <div className="border-t border-[var(--c-border)] p-3">
        <div className="flex items-center justify-between">
          {!collapsed && <div className="text-xs text-[var(--c-text-secondary)]">local@xiaok</div>}
          {collapsed && <div />}
          <div className="flex items-center gap-1">
            {updateStatus?.downloaded && (
              <button
                type="button"
                onClick={() => api.quitAndInstall()}
                className="flex h-8 w-8 items-center justify-center rounded-md text-green-500 transition-[background-color,color,transform] duration-[60ms] hover:bg-green-50 active:scale-[0.96] animate-pulse"
                title={`更新已就绪: v${updateStatus.version || '新版本'}，点击安装`}
              >
                <Download size={18} />
              </button>
            )}
            {updateStatus?.downloading && (
              <div
                className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--c-accent)]"
                title={`正在下载: ${updateStatus.progress}%`}
              >
                <RefreshCw size={18} className="animate-spin" />
              </div>
            )}
            {updateStatus?.available && !updateStatus.downloaded && !updateStatus.downloading && (
              <div
                className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--c-accent)]"
                title={`发现新版本: v${updateStatus.version || '更新'}`}
              >
                <RefreshCw size={18} className="animate-pulse" />
              </div>
            )}
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--c-text-icon)] transition-[background-color,color,transform] duration-[60ms] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] active:scale-[0.96]"
              >
                <Bolt size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
