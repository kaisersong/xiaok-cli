import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { createLogger } from '../lib/logger';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Search, X, Bolt, Pencil, RefreshCw, Clock, FolderKanban, ExternalLink, AlertTriangle } from 'lucide-react';
import { api, type ThreadRecord } from '../api';
import { useKSwarm } from '../contexts/KSwarmContext';
import { useLocale } from '../contexts/LocaleContext';
import {
  collectScheduledRuntimeTaskIds,
  ensureAggregatedScheduledThread,
  mergeScheduledTaskCache,
  normalizeScheduledTaskRuntimeLink,
  threadHasAnyRuntimeTask,
} from '../lib/scheduled-task-threads';

const log = createLogger('Sidebar');
const SIDEBAR_DETAILS_DELAY_MS = 500;

interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  installing?: boolean;
  progress: number;
  version?: string;
  error?: string;
  currentVersion?: string;
}

// During the ad-hoc-signing window (no Apple Developer cert yet), Squirrel.Mac
// cannot verify the downloaded package, so quitAndInstall silently fails and the
// button gets stuck. Until the cert lands, the reminder opens a popover that
// points users at the GitHub release for a manual download + drag-to-replace.
const GITHUB_RELEASES_URL = 'https://github.com/kaisersong/xiaok-cli/releases/latest';

interface SidebarScheduledTask {
  id: string;
  name: string;
  frequency: string;
  threadId?: string;
  runtimeTaskId?: string;
}

type NavSection = 'new' | 'scheduled' | 'projects';

interface SidebarProps {
  onOpenSettings?: () => void;
}

interface SidebarProjectSummary {
  id: string;
  name: string;
  status: string;
}

interface SidebarDetailsRow {
  label: string;
  value?: string | null;
  mono?: boolean;
}

export function SidebarComponent({ onOpenSettings }: SidebarProps) {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [showUpdatePopover, setShowUpdatePopover] = useState(false);
  const [activeNav, setActiveNav] = useState<NavSection>('new');
  const [sidebarTasks, setSidebarTasks] = useState<SidebarScheduledTask[]>([]);
  const [scheduledThreadIds, setScheduledThreadIds] = useState<Set<string>>(new Set());
  const [scheduledRuntimeTaskIds, setScheduledRuntimeTaskIds] = useState<Set<string>>(new Set());

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

  // Load scheduled tasks for sidebar and keep scheduled runs out of recent history.
  useEffect(() => {
    let disposed = false;

    const loadScheduled = async () => {
      try {
        const raw = localStorage.getItem('xiaok:scheduled-tasks');
        const localItems: SidebarScheduledTask[] = raw ? JSON.parse(raw) : [];
        let items = localItems.map(item => normalizeScheduledTaskRuntimeLink(item));
        const desktop = (window as any).xiaokDesktop;
        if (desktop?.getScheduledTasks) {
          try {
            const mainItems = await desktop.getScheduledTasks();
            if (Array.isArray(mainItems)) {
              items = mergeScheduledTaskCache(mainItems as SidebarScheduledTask[], localItems);
            }
          } catch { /* keep local cache */ }
        }

        const runtimeTaskIds = new Set<string>();
        const linkedItems: SidebarScheduledTask[] = [];
        for (const item of items) {
          let runs: unknown[] = [];
          if (desktop?.getTimedActionRuns && item.id) {
            runs = await desktop.getTimedActionRuns(item.id).catch(() => []);
          }
          const collectedRuntimeTaskIds = collectScheduledRuntimeTaskIds(item, Array.isArray(runs) ? runs : []);
          for (const runtimeTaskId of collectedRuntimeTaskIds) runtimeTaskIds.add(runtimeTaskId);
          const linked = collectedRuntimeTaskIds.length > 0
            ? await ensureAggregatedScheduledThread(item, collectedRuntimeTaskIds).catch(() => item)
            : item;
          linkedItems.push(linked);
        }

        if (disposed) return;
        localStorage.setItem('xiaok:scheduled-tasks', JSON.stringify(linkedItems));
        setSidebarTasks(linkedItems.map((t: any) => ({
          id: t.id,
          name: t.name,
          frequency: t.frequency,
          threadId: t.threadId,
          runtimeTaskId: t.runtimeTaskId,
        })));
        const threadIds = new Set<string>();
        for (const t of linkedItems) {
          if (t.threadId) threadIds.add(t.threadId);
        }
        setScheduledThreadIds(threadIds);
        setScheduledRuntimeTaskIds(runtimeTaskIds);
      } catch { /* ignore */ }
    };

    const storageHandler = (e: StorageEvent) => {
      if (e.key === 'xiaok:scheduled-tasks') void loadScheduled();
    };
    const updateHandler = () => void loadScheduled();

    void loadScheduled();
    window.addEventListener('storage', storageHandler);
    window.addEventListener('xiaok:scheduled-tasks-updated', updateHandler);
    return () => {
      disposed = true;
      window.removeEventListener('storage', storageHandler);
      window.removeEventListener('xiaok:scheduled-tasks-updated', updateHandler);
    };
  }, []);

  // Subscribe to update status
  useEffect(() => {
    const unsub = api.onUpdateStatus((status) =>
      setUpdateStatus(prev => ({
        ...(status as UpdateStatus),
        currentVersion: (status as UpdateStatus).currentVersion ?? prev?.currentVersion,
      })),
    );
    api.getUpdateStatus().then(setUpdateStatus).catch(() => {});
    return unsub;
  }, []);

  // Sync activeNav with route
  useEffect(() => {
    if (routerLocation.pathname === '/scheduled') {
      setActiveNav('scheduled');
    } else if (routerLocation.pathname.startsWith('/projects')) {
      setActiveNav('projects');
    } else {
      setActiveNav('new');
    }
  }, [routerLocation.pathname]);

  const filteredThreads = (searchQuery
    ? threads.filter(t => t.title?.toLowerCase().includes(searchQuery.toLowerCase()))
    : threads
  ).filter(t => !scheduledThreadIds.has(t.id) && !threadHasAnyRuntimeTask(t, scheduledRuntimeTaskIds));

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
  const currentVersion = updateStatus?.currentVersion;
  const updateError = updateStatus?.error;
  const hasActiveUpdate = Boolean(updateStatus && (
    updateStatus.available ||
    updateStatus.downloading ||
    updateStatus.downloaded ||
    updateStatus.installing
  ));
  const hasUpdateFailure = Boolean(updateError && !hasActiveUpdate);
  const showUpdateReminder = Boolean(updateStatus && (hasActiveUpdate || updateError));
  const updateReminderLabel = hasUpdateFailure ? '更新检查失败' : `升级到 ${updateVersion}`;
  const updatePopoverTitle = hasUpdateFailure ? '更新检查失败' : '发现新版本';
  const updateReminderTitle = hasUpdateFailure
    ? `更新检查失败: ${updateError}，点击查看下载方式`
    : `发现新版本: v${updateVersion}，点击查看更新方式`;
  const updateReminderButtonClassName = hasUpdateFailure
    ? 'inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-medium text-amber-800 transition-[background-color,color,transform] duration-[60ms] hover:bg-amber-100 active:scale-[0.96]'
    : 'inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--c-accent)] px-2 text-xs font-medium text-white transition-[background-color,color,transform] duration-[60ms] hover:opacity-90 active:scale-[0.96]';
  const scheduledListClassName = activeNav === 'new'
    ? 'flex flex-col gap-0 max-h-[90px] overflow-y-auto'
    : 'flex flex-col gap-0';
  const projectListClassName = activeNav === 'new'
    ? 'flex flex-col gap-0 max-h-[150px] overflow-y-auto'
    : 'flex flex-col gap-0';

  const handleUpdateReminderClick = () => {
    setShowUpdatePopover(prev => !prev);
  };

  const handleOpenGithubReleases = () => {
    window.open(GITHUB_RELEASES_URL, '_blank', 'noopener,noreferrer');
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
          <div className="p-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--c-text-tertiary)]">
            {t.sidebarScheduled}
          </div>
          <div className={scheduledListClassName}>
            {sidebarTasks.map(task => (
              <SidebarScheduledTaskListItem
                key={task.id}
                task={task}
                onOpen={handleScheduledClick}
              />
            ))}
          </div>
        </div>
      )}

      {/* Active projects list */}
      {activeProjects.length > 0 && (activeNav === 'new' || activeNav === 'projects') && (
        <div className="px-3 py-2">
          <div className="p-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--c-text-tertiary)]">
            {t.sidebarProjects}
          </div>
          <div className={projectListClassName}>
            {activeProjects.map(project => (
              <SidebarProjectListItem
                key={project.id}
                project={project}
                onOpen={projectId => navigate(`/projects/${projectId}`)}
              />
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
              <input aria-label={t.sidebarSearch}
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
              const isSelected = routerLocation.pathname === `/t/${thread.id}`;
              return (
              <SidebarThreadListItem
                key={thread.id}
                thread={thread}
                title={thread.title || t.untitled}
                isSelected={isSelected}
                isEditing={editingId === thread.id}
                editTitle={editTitle}
                renameLabel={t.sidebarRename}
                onOpen={() => navigate(`/t/${thread.id}`)}
                onEditStart={() => handleDoubleClick(thread)}
                onDelete={e => handleDelete(e, thread.id)}
                onEditTitleChange={setEditTitle}
                onRenameSubmit={handleRenameSubmit}
                onRenameKeyDown={handleRenameKeyDown}
              />
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
              <div className="relative">
                <button
                  type="button"
                  onClick={handleUpdateReminderClick}
                  aria-label={updateReminderLabel}
                  aria-expanded={showUpdatePopover}
                  className={updateReminderButtonClassName}
                  title={updateReminderTitle}
                >
                  {hasUpdateFailure ? <AlertTriangle size={14} /> : <RefreshCw size={14} />}
                  <span>{updateReminderLabel}</span>
                </button>

                {showUpdatePopover && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowUpdatePopover(false)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setShowUpdatePopover(false) }}
                      role="button"
                      tabIndex={-1}
                      aria-label="关闭弹窗"
                    />
                    <div className="absolute bottom-10 right-0 z-50 w-72 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 shadow-lg">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-[var(--c-text-heading)]">{updatePopoverTitle}</span>
                        <button
                          type="button"
                          onClick={() => setShowUpdatePopover(false)}
                          aria-label="关闭"
                          className="flex size-6 items-center justify-center rounded text-[var(--c-text-icon)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <div className="mb-3 flex items-center gap-2 text-xs text-[var(--c-text-secondary)]">
                        {currentVersion && (
                          <>
                            <span className="rounded bg-[var(--c-bg-deep)] px-1.5 py-0.5 font-mono">v{currentVersion}</span>
                            {!hasUpdateFailure && <span>→</span>}
                          </>
                        )}
                        {!hasUpdateFailure && (
                          <span className="rounded bg-[var(--c-accent)]/10 px-1.5 py-0.5 font-mono font-semibold text-[var(--c-accent)]">v{updateVersion}</span>
                        )}
                      </div>

                      {hasUpdateFailure && updateError && (
                        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs leading-relaxed text-amber-800">
                          {updateError}
                        </p>
                      )}

                      <p className="mb-3 text-xs leading-relaxed text-[var(--c-text-secondary)]">
                        {hasUpdateFailure
                          ? '自动更新检查失败。请前往 GitHub 下载最新版，下载后将应用拖入「应用程序」覆盖安装即可。'
                          : '请前往 GitHub 下载最新版本，下载后将应用拖入「应用程序」覆盖安装即可。'}
                      </p>

                      <button
                        type="button"
                        onClick={handleOpenGithubReleases}
                        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--c-accent)] px-3 text-sm font-medium text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
                      >
                        <ExternalLink size={15} />
                        <span>前往 GitHub 下载</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex size-8 items-center justify-center rounded-md text-[var(--c-text-icon)] transition-[background-color,color,transform] duration-[60ms] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] active:scale-[0.96]"
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

function SidebarProjectListItem({
  project,
  onOpen,
}: {
  project: SidebarProjectSummary;
  onOpen: (projectId: string) => void;
}) {
  const details = useDelayedSidebarDetails<HTMLButtonElement>();

  return (
    <>
      <button
        ref={details.itemRef}
        type="button"
        onClick={() => onOpen(project.id)}
        onMouseEnter={details.scheduleDetails}
        onMouseLeave={details.hideDetails}
        onFocus={details.scheduleDetails}
        onBlur={details.hideDetails}
        className="flex w-full items-center rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-card)]"
        data-testid={`sidebar-project-${project.id}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-[var(--c-text-tertiary)]/45" />
          <span className="truncate">{project.name}</span>
        </span>
      </button>
      {details.detailsOpen && (
        <SidebarDetailsTooltip
          testId={`sidebar-project-details-${project.id}`}
          position={details.detailsPosition}
          rows={[
            { label: '项目', value: project.name },
            { label: '状态', value: project.status },
            { label: '项目 ID', value: project.id, mono: true },
          ]}
        />
      )}
    </>
  );
}

function SidebarScheduledTaskListItem({
  task,
  onOpen,
}: {
  task: SidebarScheduledTask;
  onOpen: (task: SidebarScheduledTask) => void;
}) {
  const details = useDelayedSidebarDetails<HTMLButtonElement>();

  return (
    <>
      <button
        ref={details.itemRef}
        type="button"
        onClick={() => onOpen(task)}
        onMouseEnter={details.scheduleDetails}
        onMouseLeave={details.hideDetails}
        onFocus={details.scheduleDetails}
        onBlur={details.hideDetails}
        className="flex items-center justify-between rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-card)]"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-1.5 shrink-0 rounded-full bg-[var(--c-accent)]/40" />
          <span className="truncate">{task.name}</span>
        </div>
        <span className="ml-2 shrink-0 text-[var(--c-text-tertiary)]">{task.frequency}</span>
      </button>
      {details.detailsOpen && (
        <SidebarDetailsTooltip
          testId={`sidebar-scheduled-details-${task.id}`}
          position={details.detailsPosition}
          rows={[
            { label: '定时任务', value: task.name },
            { label: '频率', value: task.frequency },
            { label: '任务 ID', value: task.id, mono: true },
            { label: '会话 ID', value: task.threadId, mono: true },
            { label: '运行任务 ID', value: task.runtimeTaskId, mono: true },
          ]}
        />
      )}
    </>
  );
}

function SidebarThreadListItem({
  thread,
  title,
  isSelected,
  isEditing,
  editTitle,
  renameLabel,
  onOpen,
  onEditStart,
  onDelete,
  onEditTitleChange,
  onRenameSubmit,
  onRenameKeyDown,
}: {
  thread: ThreadRecord;
  title: string;
  isSelected: boolean;
  isEditing: boolean;
  editTitle: string;
  renameLabel: string;
  onOpen: () => void;
  onEditStart: () => void;
  onDelete: (event: React.MouseEvent) => void;
  onEditTitleChange: (title: string) => void;
  onRenameSubmit: () => void;
  onRenameKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const details = useDelayedSidebarDetails<HTMLDivElement>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
      details.hideDetails();
    }
  }, [isEditing]);

  const taskIds = thread.taskIds.length > 0 ? thread.taskIds.join(', ') : null;

  return (
    <>
      <div
        ref={details.itemRef}
        className={`group flex cursor-pointer items-center rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--c-bg-card)] ${isSelected ? 'bg-[var(--c-bg-card)] font-semibold' : ''}`}
        onClick={onOpen}
        onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
        onMouseEnter={details.scheduleDetails}
        onMouseLeave={details.hideDetails}
        onFocus={details.scheduleDetails}
        onBlur={details.hideDetails}
        role="button"
        tabIndex={0}
        data-testid={`thread-item-${thread.id}`}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            aria-label="Rename thread"
            type="text"
            value={editTitle}
            onChange={e => onEditTitleChange(e.target.value)}
            onBlur={onRenameSubmit}
            onKeyDown={onRenameKeyDown}
            className="flex-1 rounded border border-[var(--c-accent)] bg-transparent px-1 text-sm outline-none"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate">{title}</span>
        )}
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onEditStart();
          }}
          className="ml-1 hidden shrink-0 p-0.5 text-[var(--c-text-secondary)] hover:text-[var(--c-accent)] group-hover:block"
          title={renameLabel}
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="ml-0.5 hidden shrink-0 p-0.5 text-[var(--c-text-secondary)] hover:text-red-500 group-hover:block"
        >
          <X className="size-3" />
        </button>
      </div>
      {details.detailsOpen && !isEditing && (
        <SidebarDetailsTooltip
          testId={`sidebar-thread-details-${thread.id}`}
          position={details.detailsPosition}
          rows={[
            { label: '最近任务', value: title },
            { label: '状态', value: thread.status },
            { label: '会话 ID', value: thread.id, mono: true },
            { label: '当前任务 ID', value: thread.currentTaskId, mono: true },
            { label: '任务 ID', value: taskIds, mono: true },
          ]}
        />
      )}
    </>
  );
}

function useDelayedSidebarDetails<T extends HTMLElement>() {
  const itemRef = useRef<T>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsPosition, setDetailsPosition] = useState<CSSProperties>({ top: 0, left: 0 });

  const clearDetailsTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const hideDetails = () => {
    clearDetailsTimer();
    setDetailsOpen(false);
  };

  const scheduleDetails = () => {
    clearDetailsTimer();
    timerRef.current = setTimeout(() => {
      const rect = itemRef.current?.getBoundingClientRect();
      const tooltipWidth = 236;
      const nextTop = rect
        ? Math.max(12, Math.min(rect.top, window.innerHeight - 96))
        : 12;
      const nextLeft = rect
        ? Math.max(12, Math.min(rect.right + 8, window.innerWidth - tooltipWidth - 12))
        : 12;
      setDetailsPosition({ top: nextTop, left: nextLeft });
      setDetailsOpen(true);
      timerRef.current = null;
    }, SIDEBAR_DETAILS_DELAY_MS);
  };

  useEffect(() => () => clearDetailsTimer(), []);

  return {
    itemRef,
    detailsOpen,
    detailsPosition,
    scheduleDetails,
    hideDetails,
  };
}

function SidebarDetailsTooltip({
  testId,
  position,
  rows,
}: {
  testId: string;
  position: CSSProperties;
  rows: SidebarDetailsRow[];
}) {
  const visibleRows = rows.filter(row => row.value);

  return (
    <div
      role="tooltip"
      data-testid={testId}
      className="pointer-events-none fixed z-[70] w-[236px] rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-3 py-2 text-left text-[11px] leading-relaxed text-[var(--c-text-secondary)] shadow-xl"
      style={position}
    >
      {visibleRows.map(row => (
        <div key={row.label} className="flex items-start justify-between gap-2">
          <span className="shrink-0 text-[var(--c-text-tertiary)]">{row.label}</span>
          <span className={`min-w-0 text-right text-[var(--c-text-primary)] ${row.mono ? 'break-all font-mono text-[10px]' : 'font-medium'}`}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
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
        <img src={avatar} alt="" className="size-6 rounded-full object-cover shrink-0" />
      ) : (
        <div
          className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold shrink-0"
          style={{ background: 'var(--c-avatar-bg, #e2e8f0)', color: 'var(--c-avatar-text, #475569)' }}
        >
          {initial}
        </div>
      )}
      <span className="text-xs text-[var(--c-text-secondary)] truncate">{displayName}</span>
    </div>
  );
}
