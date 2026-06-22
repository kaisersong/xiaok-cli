import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { createLogger } from '../lib/logger';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Search, X, Bolt, Pencil, RefreshCw, FolderKanban, ExternalLink, BookOpen, MoreHorizontal } from 'lucide-react';
import { api, type ThreadResponse } from '../api';
import { useThreadList } from '../contexts/thread-list';
import { useKSwarm } from '../contexts/KSwarmContext';
import { useLocale } from '../contexts/LocaleContext';
import { getDesktopApi } from '../shared/desktop';
import { ConfirmDialog } from './shared/ConfirmDialog';
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

type NavSection = 'new' | 'automations' | 'projects' | 'knowledge';

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
  const { threads, removeThread, updateTitle, setThreadGtdBucket } = useThreadList();
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [gtdEnabled, setGtdEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('xiaok:gtd-enabled') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setGtdEnabled(Boolean(detail));
    };
    window.addEventListener('xiaok:gtd-enabled-changed', handler);
    return () => window.removeEventListener('xiaok:gtd-enabled-changed', handler);
  }, []);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [showUpdatePopover, setShowUpdatePopover] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const updateButtonRef = useRef<HTMLButtonElement>(null);
  const [activeNav, setActiveNav] = useState<NavSection>('new');
  const [sidebarTasks, setSidebarTasks] = useState<SidebarScheduledTask[]>([]);
  const [scheduledThreadIds, setScheduledThreadIds] = useState<Set<string>>(new Set());
  const [scheduledRuntimeTaskIds, setScheduledRuntimeTaskIds] = useState<Set<string>>(new Set());
  const [scheduledUnread, setScheduledUnread] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('xiaok:scheduled-unread');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });

  const { projects } = useKSwarm();
  const { t } = useLocale();
  const activeProjects = projects.filter(p => p.status !== 'closed');

  // Load scheduled tasks for sidebar and keep scheduled runs out of recent history.
  useEffect(() => {
    let disposed = false;

    const loadScheduled = async () => {
      try {
        const raw = localStorage.getItem('xiaok:scheduled-tasks');
        const localItems: SidebarScheduledTask[] = raw ? JSON.parse(raw) : [];
        let items = localItems.map(item => normalizeScheduledTaskRuntimeLink(item));
        const desktop = getDesktopApi();
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

  useEffect(() => {
    const reload = () => {
      try {
        const raw = localStorage.getItem('xiaok:scheduled-unread');
        setScheduledUnread(raw ? JSON.parse(raw) : {});
      } catch { setScheduledUnread({}); }
    };
    const storageHandler = (e: StorageEvent) => {
      if (e.key === 'xiaok:scheduled-unread') reload();
    };
    const changeHandler = () => reload();
    const dueHandler = () => reload();
    window.addEventListener('storage', storageHandler);
    window.addEventListener('xiaok:scheduled-unread-changed', changeHandler);
    window.addEventListener('xiaok:scheduled-tasks-updated', dueHandler);
    return () => {
      window.removeEventListener('storage', storageHandler);
      window.removeEventListener('xiaok:scheduled-unread-changed', changeHandler);
      window.removeEventListener('xiaok:scheduled-tasks-updated', dueHandler);
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
    if (routerLocation.pathname === '/scheduled' || routerLocation.pathname.startsWith('/automations')) {
      setActiveNav('automations');
    } else if (routerLocation.pathname.startsWith('/projects')) {
      setActiveNav('projects');
    } else if (routerLocation.pathname.startsWith('/knowledge')) {
      setActiveNav('knowledge');
    } else {
      setActiveNav('new');
    }
  }, [routerLocation.pathname]);

  const filteredThreads = (searchQuery
    ? threads.filter(t => t.title?.toLowerCase().includes(searchQuery.toLowerCase()))
    : threads
  ).filter(t => !scheduledThreadIds.has(t.id) && !threadHasAnyRuntimeTask(t, scheduledRuntimeTaskIds));

  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; title: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const t = threads.find(x => x.id === id);
    setDeleteCandidate({ id, title: t?.title || '' });
  };

  const performDelete = async () => {
    if (!deleteCandidate) return;
    setDeleteLoading(true);
    try {
      log.info('deleteThread', deleteCandidate.id);
      await api.deleteThread(deleteCandidate.id);
      removeThread(deleteCandidate.id);
      log.info('deleteThread ok');
    } finally {
      setDeleteLoading(false);
      setDeleteCandidate(null);
    }
  };

  const handleDoubleClick = (thread: ThreadResponse) => {
    setEditingId(thread.id);
    setEditTitle(thread.title || '');
  };

  const handleRenameSubmit = async () => {
    if (editingId && editTitle.trim()) {
      log.info('renameThread', JSON.stringify({ id: editingId, newTitle: editTitle.trim() }));
      await api.updateThreadTitle(editingId, editTitle.trim());
      log.info('renameThread ok');
      updateTitle(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameSubmit();
    if (e.key === 'Escape') setEditingId(null);
  };

  const handleScheduledClick = (task: SidebarScheduledTask) => {
    try {
      const raw = localStorage.getItem('xiaok:scheduled-unread');
      const unread: Record<string, number> = raw ? JSON.parse(raw) : {};
      if (unread[task.id]) {
        delete unread[task.id];
        localStorage.setItem('xiaok:scheduled-unread', JSON.stringify(unread));
        setScheduledUnread(unread);
        window.dispatchEvent(new CustomEvent('xiaok:scheduled-unread-changed'));
      }
    } catch { /* best-effort */ }
    if (task.threadId) {
      navigate(`/t/${task.threadId}`);
    } else {
      navigate('/automations/schedules');
    }
  };

  const isOnScheduled = activeNav === 'automations';
  const hideThreadList = activeNav === 'automations' || activeNav === 'projects' || activeNav === 'knowledge';
  const updateVersion = updateStatus?.version || t.sidebarUpdateNewVersion;
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
  const updateReminderLabel = hasUpdateFailure ? t.sidebarUpdateCheckIncomplete : t.sidebarUpdateUpgradeTo(updateVersion);
  const updatePopoverTitle = hasUpdateFailure ? t.sidebarUpdateCheckIncomplete : t.sidebarUpdateFoundNewVersion;
  const updateReminderTitle = hasUpdateFailure
    ? t.sidebarUpdateCheckIncompleteHint
    : t.sidebarUpdateFoundVersionHint(updateVersion);
  const updateReminderButtonClassName = hasUpdateFailure
    ? 'inline-flex h-8 items-center rounded-md px-1.5 text-[11px] font-medium text-[var(--c-text-tertiary)] transition-[background-color,color,transform] duration-[60ms] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-secondary)] active:scale-[0.96]'
    : 'inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--c-accent)] px-2 text-xs font-medium text-white transition-[background-color,color,transform] duration-[60ms] hover:opacity-90 active:scale-[0.96]';
  const scheduledListClassName = activeNav === 'new'
    ? 'flex flex-col gap-0 max-h-[90px] overflow-y-auto'
    : 'flex flex-col gap-0';
  const projectListClassName = activeNav === 'new'
    ? 'flex flex-col gap-0 max-h-[150px] overflow-y-auto'
    : 'flex flex-col gap-0';

  const handleUpdateReminderClick = () => {
    setShowUpdatePopover(prev => {
      const next = !prev;
      if (next && updateButtonRef.current) {
        const rect = updateButtonRef.current.getBoundingClientRect();
        const popoverWidth = 288;
        const popoverHeight = 220;
        let left = rect.right - popoverWidth;
        let top = rect.top - popoverHeight - 8;
        if (left < 8) left = 8;
        if (left + popoverWidth > window.innerWidth - 8) left = window.innerWidth - popoverWidth - 8;
        if (top < 8) top = rect.bottom + 8;
        setPopoverPos({ top, left });
      }
      return next;
    });
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
            onClick={() => navigate('/automations')}
            className={`flex h-[36px] items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
              isOnScheduled
                ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-primary)]'
                : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]'
            }`}
            title={t.sidebarAutomations}
          >
            <Bolt size={16} className="shrink-0" />
            <span>{t.sidebarAutomations}</span>
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
          <button
            type="button"
            onClick={() => navigate('/knowledge')}
            className={`flex h-[36px] items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
              activeNav === 'knowledge'
                ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-primary)]'
                : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]'
            }`}
            title={t.sidebarKnowledge}
          >
            <BookOpen size={16} className="shrink-0" />
            <span>{t.sidebarKnowledge}</span>
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="px-4">
        <div className="h-px bg-[var(--c-border)]" />
      </div>

      {/* Scheduled tasks list (Claude-style) */}
      {sidebarTasks.length > 0 && (activeNav === 'new' || activeNav === 'automations') && (
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
                unreadCount={scheduledUnread[task.id]}
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
            {!gtdEnabled && (
              <div className="py-1 text-xs font-medium text-[var(--c-text-secondary)]">
                {t.sidebarRecent}
              </div>
            )}
            {filteredThreads.length === 0 && (
              <p className="py-3 text-center text-xs text-[var(--c-text-secondary)]">
                {searchQuery ? t.sidebarNoResults : t.sidebarNoRecent}
              </p>
            )}
            {gtdEnabled ? (
              (() => {
                const buckets: Array<{ key: 'active' | 'archived'; label: string }> = [
                  { key: 'active', label: t.gtdActive },
                  { key: 'archived', label: t.gtdArchived },
                ];
                const grouped: Record<'active' | 'archived', ThreadResponse[]> = { active: [], archived: [] };
                for (const th of filteredThreads) {
                  const isArchived = th.sidebar_gtd_bucket === 'archived';
                  grouped[isArchived ? 'archived' : 'active'].push(th);
                }
                return (
                  <>
                    {buckets.map(({ key, label }) => (
                      grouped[key].length > 0 && (
                        <div key={key} className="mb-2">
                          <div className="py-1 text-xs font-medium text-[var(--c-text-secondary)]">{label}</div>
                          {grouped[key].map(thread => {
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
                                gtdEnabled={true}
                                onMoveToBucket={(bucket) => setThreadGtdBucket(thread.id, bucket === 'archived' ? 'archived' : 'inbox')}
                              />
                            );
                          })}
                        </div>
                      )
                    ))}
                  </>
                );
              })()
            ) : (
              filteredThreads.map(thread => {
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
                  gtdEnabled={false}
                />
              );})
            )}
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
                  ref={updateButtonRef}
                  type="button"
                  onClick={handleUpdateReminderClick}
                  aria-label={updateReminderLabel}
                  aria-expanded={showUpdatePopover}
                  className={updateReminderButtonClassName}
                  title={updateReminderTitle}
                >
                  {!hasUpdateFailure && <RefreshCw size={14} />}
                  <span>{updateReminderLabel}</span>
                </button>

                {showUpdatePopover && popoverPos && createPortal(
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowUpdatePopover(false)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setShowUpdatePopover(false) }}
                      role="button"
                      tabIndex={-1}
                      aria-label={t.sidebarUpdateClosePopover}
                    />
                    <div
                      className="fixed z-50 w-72 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 shadow-lg"
                      style={{ top: popoverPos.top, left: popoverPos.left }}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-[var(--c-text-heading)]">{updatePopoverTitle}</span>
                        <button
                          type="button"
                          onClick={() => setShowUpdatePopover(false)}
                          aria-label={t.sidebarUpdateClose}
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
                        <p className="mb-3 rounded-md bg-[var(--c-bg-deep)] px-2 py-1.5 text-xs leading-relaxed text-[var(--c-text-secondary)]">
                          {updateError}
                        </p>
                      )}

                      <p className="mb-3 text-xs leading-relaxed text-[var(--c-text-secondary)]">
                        {hasUpdateFailure
                          ? t.sidebarUpdateAutoCheckFailed
                          : t.sidebarUpdateManualDownload}
                      </p>

                      <button
                        type="button"
                        onClick={handleOpenGithubReleases}
                        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--c-accent)] px-3 text-sm font-medium text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
                      >
                        <ExternalLink size={15} />
                        <span>{t.sidebarUpdateGoToGithub}</span>
                      </button>
                    </div>
                  </>,
                  document.body,
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
      <ConfirmDialog
        open={deleteCandidate !== null}
        onClose={() => !deleteLoading && setDeleteCandidate(null)}
        onConfirm={performDelete}
        title={t.deleteThreadConfirmTitle}
        message={t.deleteThreadConfirmBody}
        confirmLabel={t.deleteThreadConfirm}
        cancelLabel={t.deleteThreadCancel}
        loading={deleteLoading}
      />
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
  const { t } = useLocale();

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
            { label: t.sidebarTooltipProject, value: project.name },
            { label: t.sidebarTooltipStatus, value: project.status },
            { label: t.sidebarTooltipProjectId, value: project.id, mono: true },
          ]}
        />
      )}
    </>
  );
}

function SidebarScheduledTaskListItem({
  task,
  onOpen,
  unreadCount,
}: {
  task: SidebarScheduledTask;
  onOpen: (task: SidebarScheduledTask) => void;
  unreadCount?: number;
}) {
  const details = useDelayedSidebarDetails<HTMLButtonElement>();
  const { t } = useLocale();

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
          <div
            className={`size-1.5 shrink-0 rounded-full ${
              unreadCount && unreadCount > 0
                ? 'bg-[var(--c-accent)]'
                : 'bg-[var(--c-accent)]/40'
            }`}
            aria-label={unreadCount && unreadCount > 0 ? `${unreadCount} unread` : undefined}
          />
          <span className={`truncate ${unreadCount && unreadCount > 0 ? 'font-medium text-[var(--c-text-primary)]' : ''}`}>{task.name}</span>
        </div>
        <span className="ml-2 shrink-0 text-[var(--c-text-tertiary)]">{task.frequency}</span>
      </button>
      {details.detailsOpen && (
        <SidebarDetailsTooltip
          testId={`sidebar-scheduled-details-${task.id}`}
          position={details.detailsPosition}
          rows={[
            { label: t.sidebarTooltipScheduledTask, value: task.name },
            { label: t.sidebarTooltipFrequency, value: task.frequency },
            { label: t.sidebarTooltipTaskId, value: task.id, mono: true },
            { label: t.sidebarTooltipThreadId, value: task.threadId, mono: true },
            { label: t.sidebarTooltipRuntimeTaskId, value: task.runtimeTaskId, mono: true },
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
  gtdEnabled,
  onMoveToBucket,
}: {
  thread: ThreadResponse;
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
  gtdEnabled?: boolean;
  onMoveToBucket?: (bucket: 'active' | 'archived') => void;
}) {
  const details = useDelayedSidebarDetails<HTMLDivElement>();
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useLocale();
  const [bucketMenuOpen, setBucketMenuOpen] = useState(false);
  const bucketMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
      details.hideDetails();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!bucketMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (bucketMenuRef.current?.contains(e.target as Node)) return;
      setBucketMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [bucketMenuOpen]);

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
        {gtdEnabled && onMoveToBucket && !isEditing && (
          <div ref={bucketMenuRef} className="relative ml-1 hidden shrink-0 group-hover:block">
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                setBucketMenuOpen(v => !v);
              }}
              className="p-0.5 text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]"
              title={t.gtdMoveToInbox}
            >
              <MoreHorizontal className="size-3" />
            </button>
            {bucketMenuOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 flex w-32 flex-col rounded-lg py-1"
                style={{
                  background: 'var(--c-bg-menu)',
                  border: '0.5px solid var(--c-border-subtle)',
                  boxShadow: 'var(--c-dropdown-shadow)',
                }}
                onClick={e => e.stopPropagation()}
              >
                {([
                  { key: 'active' as const, label: t.gtdMoveToActive },
                  { key: 'archived' as const, label: t.gtdMoveToArchived },
                ]).map(({ key, label }) => {
                  const isCurrent = key === 'archived'
                    ? thread.sidebar_gtd_bucket === 'archived'
                    : thread.sidebar_gtd_bucket !== 'archived';
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        onMoveToBucket(key);
                        setBucketMenuOpen(false);
                      }}
                      className="px-3 py-1.5 text-left text-xs text-[var(--c-text-primary)] hover:bg-[var(--c-bg-deep)]"
                      style={{ fontWeight: isCurrent ? 600 : 400 }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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
            { label: t.sidebarTooltipRecentTask, value: title },
            { label: t.sidebarTooltipStatus, value: thread.status },
            { label: t.sidebarTooltipThreadId, value: thread.id, mono: true },
            { label: t.sidebarTooltipCurrentTaskId, value: thread.currentTaskId, mono: true },
            { label: t.sidebarTooltipTaskId, value: taskIds, mono: true },
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
