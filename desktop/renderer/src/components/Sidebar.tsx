import { useState, useEffect, useRef } from 'react';
import { createLogger } from '../lib/logger';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Search, X, Bolt, Pencil, Download, RefreshCw, Clock, FolderKanban } from 'lucide-react';
import { api, type ThreadRecord } from '../api';
import { useKSwarm } from '../contexts/KSwarmContext';
import { useLocale } from '../contexts/LocaleContext';

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

type NavSection = 'new' | 'scheduled' | 'projects';

interface SidebarProps {
  onOpenSettings?: () => void;
}

export function SidebarComponent({ onOpenSettings }: SidebarProps) {
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

  const { projects } = useKSwarm();
  const { t } = useLocale();
  const activeProjects = projects.filter(p => p.status !== 'closed');

  // Load threads
  useEffect(() => {
    const load = () => api.listThreads({ limit: 50 }).then(setThreads);
    load();
    const interval = setInterval(load, 10_000);
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
    } else if (location.pathname.startsWith('/projects')) {
      setActiveNav('projects');
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
  const hideThreadList = activeNav === 'scheduled' || activeNav === 'projects';
  const updateVersion = updateStatus?.version || '新版本';
  const showUpdateReminder = Boolean(updateStatus && (
    updateStatus.checking ||
    updateStatus.available ||
    updateStatus.downloading ||
    updateStatus.downloaded
  ));
  const updateReminderLabel = updateStatus?.downloaded
    ? `安装 ${updateVersion}`
    : updateStatus?.downloading
      ? `${updateStatus.progress}%`
      : updateStatus?.checking
        ? '检查中'
        : `升级到 ${updateVersion}`;

  const handleUpdateReminderClick = async () => {
    if (!updateStatus || updateStatus.downloading || updateStatus.checking) return;
    if (updateStatus.downloaded) {
      await api.quitAndInstall();
      return;
    }
    await api.checkForUpdates();
  };

  return (
    <aside
      className="relative flex w-60 flex-col border-r border-[var(--c-border)] bg-[var(--c-bg-sidebar)]"
      style={{ paddingTop: 12 }}
    >
      {/* Main navigation */}
      <div className="px-2">
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => navigate('/')}
            className={`flex h-[36px] items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
              activeNav === 'new'
                ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-primary)]'
                : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]'
            }`}
            title={t.sidebarNewTask}
          >
            <Plus size={16} className="shrink-0" />
            <span>{t.sidebarNewTask}</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/scheduled')}
            className={`flex h-[36px] items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
              isOnScheduled
                ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-primary)]'
                : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]'
            }`}
            title={t.sidebarScheduled}
          >
            <Clock size={16} className="shrink-0" />
            <span>{t.sidebarScheduled}</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className={`flex h-[36px] items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
              activeNav === 'projects'
                ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-primary)]'
                : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]'
            }`}
            title={t.sidebarProjects}
          >
            <FolderKanban size={16} className="shrink-0" />
            <span>{t.sidebarProjects}</span>
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="px-4">
        <div className="h-px bg-[var(--c-border)]" />
      </div>

      {/* Scheduled tasks list (Claude-style) */}
      {sidebarTasks.length > 0 && (activeNav === 'new' || activeNav === 'scheduled') && (
        <div className="px-3 py-2">
          <div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--c-text-tertiary)]">
            {t.sidebarScheduled}
          </div>
          <div className="flex flex-col gap-0 max-h-[90px] overflow-y-auto">
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

      {/* Active projects list */}
      {activeProjects.length > 0 && (activeNav === 'new' || activeNav === 'projects') && (
        <div className="px-3 py-2">
          <div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--c-text-tertiary)]">
            {t.sidebarProjects}
          </div>
          <div className="flex flex-col gap-0 max-h-[150px] overflow-y-auto">
            {activeProjects.map(project => (
              <button
                key={project.id}
                type="button"
                onClick={() => navigate(`/projects/${project.id}`)}
                className="flex items-center justify-between rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-card)] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                    project.status === 'active' ? 'bg-green-500' :
                    project.status === 'delivered' ? 'bg-blue-500' :
                    'bg-yellow-500'
                  }`} />
                  <span className="truncate">{project.name}</span>
                </div>
                <span className="shrink-0 text-[10px] text-[var(--c-text-tertiary)] ml-2">{project.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Divider before thread list */}
      {!hideThreadList && (
        <>
          {/* Search */}
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5">
              <Search className="size-3.5 text-[var(--c-text-secondary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t.sidebarSearch}
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
              {t.sidebarRecent}
            </div>
            {filteredThreads.length === 0 && (
              <p className="py-3 text-center text-xs text-[var(--c-text-secondary)]">
                {searchQuery ? t.sidebarNoResults : t.sidebarNoRecent}
              </p>
            )}
            {filteredThreads.map(thread => {
              const isSelected = location.pathname === `/t/${thread.id}`;
              return (
              <div
                key={thread.id}
                className={`group flex cursor-pointer items-center rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--c-bg-card)] ${isSelected ? 'bg-[var(--c-bg-card)] font-semibold' : ''}`}
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
                  <span className="flex-1 truncate">{thread.title || t.untitled}</span>
                )}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    handleDoubleClick(thread);
                  }}
                  className="ml-1 hidden shrink-0 p-0.5 text-[var(--c-text-secondary)] hover:text-[var(--c-accent)] group-hover:block"
                  title={t.sidebarRename}
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
            );})}
          </div>
        </>
      )}

      {/* Spacer for scheduled/projects page view */}
      {hideThreadList && <div className="flex-1" />}

      {/* Footer with user profile and settings button */}
      <div className="border-t border-[var(--c-border)] p-3">
        <div className="flex items-center justify-between">
          <SidebarUserProfile />
          <div className="flex items-center gap-1">
            {showUpdateReminder && (
              <button
                type="button"
                onClick={handleUpdateReminderClick}
                disabled={updateStatus?.downloading || updateStatus?.checking}
                aria-label={updateReminderLabel}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-[background-color,color,transform] duration-[60ms] active:scale-[0.96] ${
                  updateStatus?.downloaded
                    ? 'bg-green-50 text-green-700 hover:bg-green-100'
                    : updateStatus?.downloading || updateStatus?.checking
                      ? 'cursor-default bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]'
                      : 'bg-[var(--c-accent)] text-white hover:opacity-90'
                }`}
                title={
                  updateStatus?.downloaded
                    ? `更新已就绪: v${updateVersion}，点击安装`
                    : updateStatus?.downloading
                      ? `正在下载: ${updateStatus.progress}%`
                      : updateStatus?.checking
                        ? '正在检查更新'
                        : `发现新版本: v${updateVersion}，点击升级`
                }
              >
                {updateStatus?.downloaded ? (
                  <Download size={14} />
                ) : (
                  <RefreshCw size={14} className={updateStatus?.downloading || updateStatus?.checking ? 'animate-spin' : ''} />
                )}
                <span>{updateReminderLabel}</span>
              </button>
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

function SidebarUserProfile() {
  const [name, setName] = useState(() => localStorage.getItem('xiaok_display_name') || '');
  const [avatar, setAvatar] = useState(() => localStorage.getItem('xiaok_avatar_url') || '');

  useEffect(() => {
    const handler = () => {
      setName(localStorage.getItem('xiaok_display_name') || '');
      setAvatar(localStorage.getItem('xiaok_avatar_url') || '');
    };
    window.addEventListener('xiaok-profile-changed', handler);
    return () => window.removeEventListener('xiaok-profile-changed', handler);
  }, []);

  const displayName = name || 'local';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2 min-w-0">
      {avatar ? (
        <img src={avatar} alt="" className="h-6 w-6 rounded-full object-cover shrink-0" />
      ) : (
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold shrink-0"
          style={{ background: 'var(--c-avatar-bg, #e2e8f0)', color: 'var(--c-avatar-text, #475569)' }}
        >
          {initial}
        </div>
      )}
      <span className="text-xs text-[var(--c-text-secondary)] truncate">{displayName}</span>
    </div>
  );
}
