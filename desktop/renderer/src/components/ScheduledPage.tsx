import { useState, useEffect } from 'react';
import { Plus, X, Clock, Edit3, Trash2, Play, ChevronLeft, Settings as SettingsIcon, XCircle } from 'lucide-react';
import { api, type ThreadRecord } from '../api';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../contexts/LocaleContext';

interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  prompt: string;
  frequency: 'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly';
  status: 'active' | 'paused';
  createdAt: number;
  updatedAt: number;
  threadId?: string;       // Latest thread for this task
  lastRunAt?: number;
  nextRunAt?: number;
  scheduleConfig?: {
    intervalMinutes?: number;  // hourly: interval in minutes (30/60/120/...)
    hour?: number;             // daily/weekdays/weekly: 0-23
    minute?: number;           // daily/weekdays/weekly: 0-59
    dayOfWeek?: number;        // weekly: 0=Sun, 1=Mon, ...6=Sat
  };
}

type ModalMode = 'create' | 'edit' | null;

const FREQUENCY_OPTIONS = [
  { value: 'manual' as const },
  { value: 'hourly' as const },
  { value: 'daily' as const },
  { value: 'weekdays' as const },
  { value: 'weekly' as const },
];

// Scheduled task context prefix — placed at the START of prompt so LLM sees it first
const SCHEDULED_CONTEXT_PREFIX = `[SYSTEM: 这是用户设置的自动定时任务，请给出友好简洁的回复。]\n\n`;

const INTERVAL_OPTIONS = [
  { value: 30 },
  { value: 60 },
  { value: 120 },
  { value: 180 },
  { value: 240 },
  { value: 360 },
  { value: 480 },
  { value: 720 },
];

const DAY_OPTIONS = [
  { value: 0 },
  { value: 1 },
  { value: 2 },
  { value: 3 },
  { value: 4 },
  { value: 5 },
  { value: 6 },
];

function computeNextRunAt(
  frequency: ScheduledTask['frequency'],
  config: ScheduledTask['scheduleConfig'],
  fromTime = Date.now()
): number | undefined {
  if (frequency === 'manual' || !config) return undefined;

  if (frequency === 'hourly') {
    const interval = (config.intervalMinutes || 60) * 60_000;
    return fromTime + interval;
  }

  const hour = config.hour ?? 9;
  const minute = config.minute ?? 0;
  const now = new Date(fromTime);

  if (frequency === 'daily') {
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= fromTime) target.setDate(target.getDate() + 1);
    return target.getTime();
  }

  if (frequency === 'weekdays') {
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= fromTime) target.setDate(target.getDate() + 1);
    // Skip to next weekday
    while (target.getDay() === 0 || target.getDay() === 6) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  if (frequency === 'weekly') {
    const dayOfWeek = config.dayOfWeek ?? 1; // default Monday
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    // Find next occurrence of dayOfWeek
    const diff = (dayOfWeek - target.getDay() + 7) % 7;
    if (diff === 0 && target.getTime() <= fromTime) {
      target.setDate(target.getDate() + 7);
    } else {
      target.setDate(target.getDate() + diff);
    }
    return target.getTime();
  }

  return undefined;
}

export function ScheduledPage() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteInstanceId, setConfirmDeleteInstanceId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formFrequency, setFormFrequency] = useState<'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly'>('manual');
  const [formScheduleConfig, setFormScheduleConfig] = useState<ScheduledTask['scheduleConfig']>({});
  const [saving, setSaving] = useState(false);

  const frequencyLabels: Record<string, string> = {
    manual: t.scheduledManual,
    hourly: t.scheduledHourly,
    daily: t.scheduledDaily,
    weekdays: t.scheduledWeekdays,
    weekly: t.scheduledWeekly,
  };

  const intervalLabels: Record<number, string> = {
    30: t.scheduledEvery30Min,
    60: t.scheduledEveryHour,
    120: t.scheduledEvery2Hours,
    180: t.scheduledEvery3Hours,
    240: t.scheduledEvery4Hours,
    360: t.scheduledEvery6Hours,
    480: t.scheduledEvery8Hours,
    720: t.scheduledEvery12Hours,
  };

  const dayLabels: Record<number, string> = {
    0: t.scheduledSun,
    1: t.scheduledMon,
    2: t.scheduledTue,
    3: t.scheduledWed,
    4: t.scheduledThu,
    5: t.scheduledFri,
    6: t.scheduledSat,
  };

  useEffect(() => {
    loadTasks();

    // Listen for reminder events from the main process preload bridge.
    return api.onReminder(() => loadTasks());
  }, []);

  // Sync tasks to main on mount + refresh when global bootstrap executes a task
  useEffect(() => {
    const desktop = (window as any).xiaokDesktop;

    // Re-sync to main in case localStorage was updated externally
    const raw = localStorage.getItem('xiaok:scheduled-tasks');
    const items = raw ? JSON.parse(raw) : [];
    if (items.length > 0 && desktop?.syncScheduledTasks) {
      desktop.syncScheduledTasks(items).catch(() => {});
    }

    // Refresh task list when global bootstrap auto-executes a task
    const handleUpdated = () => loadTasks();
    window.addEventListener('xiaok:scheduled-tasks-updated', handleUpdated);
    return () => window.removeEventListener('xiaok:scheduled-tasks-updated', handleUpdated);
  }, []);

  const loadTasks = async () => {
    try {
      const raw = localStorage.getItem('xiaok:scheduled-tasks');
      const localItems = raw ? JSON.parse(raw) : [];

      // Also load IPC reminders and merge
      let ipcReminders: ScheduledTask[] = [];
      try {
        const status = await api.getReminderStatus();
        ipcReminders = status.activeReminders.map((r: any) => ({
          id: r.reminderId,
          name: r.content,
          description: '',
          prompt: r.content,
          frequency: 'manual' as const,
          status: 'active' as const,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
      } catch { /* ignore */ }

      const allMap = new Map<string, ScheduledTask>();
      for (const t of [...ipcReminders, ...localItems]) {
        allMap.set(t.id, t);
      }
      setTasks(Array.from(allMap.values()));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const saveTasks = (newTasks: ScheduledTask[]) => {
    localStorage.setItem('xiaok:scheduled-tasks', JSON.stringify(newTasks));
    setTasks(newTasks);
    // Dispatch event so sidebar can update
    window.dispatchEvent(new CustomEvent('xiaok:scheduled-tasks-updated'));
    // Sync to main process scheduler
    const desktop = (window as any).xiaokDesktop;
    if (desktop?.syncScheduledTasks) {
      desktop.syncScheduledTasks(newTasks).catch(() => {});
    }
  };

  const openCreate = () => {
    setFormName('');
    setFormDesc('');
    setFormPrompt('');
    setFormFrequency('manual');
    setFormScheduleConfig({});
    setEditingTask(null);
    setModalMode('create');
  };

  const openEdit = (task: ScheduledTask) => {
    setFormName(task.name);
    setFormDesc(task.description);
    setFormPrompt(task.prompt);
    setFormFrequency(task.frequency);
    setFormScheduleConfig(task.scheduleConfig || {});
    setEditingTask(task);
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingTask(null);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formPrompt.trim()) return;
    setSaving(true);

    const now = Date.now();
    const nextRunAt = computeNextRunAt(formFrequency, formScheduleConfig, now);

    if (modalMode === 'create') {
      const newTask: ScheduledTask = {
        id: crypto.randomUUID(),
        name: formName.trim(),
        description: formDesc.trim(),
        prompt: formPrompt.trim(),
        frequency: formFrequency,
        scheduleConfig: formFrequency !== 'manual' ? formScheduleConfig : undefined,
        nextRunAt,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      saveTasks([newTask, ...tasks]);
    } else if (editingTask) {
      const updated = tasks.map(t =>
        t.id === editingTask.id
          ? { ...t, name: formName.trim(), description: formDesc.trim(), prompt: formPrompt.trim(), frequency: formFrequency, scheduleConfig: formFrequency !== 'manual' ? formScheduleConfig : undefined, nextRunAt, updatedAt: now }
          : t
      );
      saveTasks(updated);
    }

    setSaving(false);
    closeModal();
  };

  const handleDelete = (id: string) => {
    setConfirmDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    // Cancel in main process (IPC reminder) so it won't be re-merged on reload
    try { await api.cancelReminder(confirmDeleteId); } catch { /* may not exist in IPC */ }
    saveTasks(tasks.filter(task => task.id !== confirmDeleteId));
    setConfirmDeleteId(null);
  };

  const handleDeleteInstance = (id: string) => {
    setConfirmDeleteInstanceId(id);
  };

  const confirmDeleteInstance = async () => {
    if (!confirmDeleteInstanceId) return;
    const task = tasks.find(t => t.id === confirmDeleteInstanceId);
    if (task?.threadId) {
      try {
        await api.deleteThread(task.threadId);
      } catch { /* ignore */ }
      // Clear threadId from the definition
      saveTasks(tasks.map(t =>
        t.id === confirmDeleteInstanceId
          ? { ...t, threadId: undefined, lastRunAt: undefined }
          : t
      ));
    }
    setConfirmDeleteInstanceId(null);
  };

  const handleToggle = (task: ScheduledTask) => {
    saveTasks(tasks.map(t =>
      t.id === task.id ? { ...t, status: t.status === 'active' ? 'paused' : 'active' } : t
    ));
  };

  const handleRun = async (task: ScheduledTask) => {
    if (runningId === task.id) return;
    setRunningId(task.id);

    try {
      let threadId = task.threadId;

      if (threadId) {
        // Reuse existing thread — update task ID but keep same thread
        try {
          const { taskId } = await api.createTask({
            prompt: SCHEDULED_CONTEXT_PREFIX + task.prompt,
            materials: [],
          });
          await api.updateThreadTaskId(threadId, taskId);
        } catch (e) {
          // Thread might be deleted or stale — fallback to new thread
          console.warn('[Scheduled] Reuse thread failed, creating new:', e);
          threadId = undefined;
        }
      }

      if (!threadId) {
        // First run or thread lost — create new thread
        const thread = await api.createThread({ title: task.name.slice(0, 40) });
        const { taskId } = await api.createTask({
          prompt: SCHEDULED_CONTEXT_PREFIX + task.prompt,
          materials: [],
        });
        await api.updateThreadTaskId(thread.id, taskId);
        threadId = thread.id;
      }

      // Update task record — recompute nextRunAt so scheduler continues auto-executing
      const now = Date.now();
      saveTasks(tasks.map(t =>
        t.id === task.id
          ? { ...t, lastRunAt: now, updatedAt: now, threadId, nextRunAt: computeNextRunAt(t.frequency, t.scheduleConfig, now) }
          : t
      ));

      // Navigate to thread
      navigate(`/t/${threadId}`, { state: { initialPrompt: task.prompt } });
    } catch (e) {
      console.error('[Scheduled] Run failed:', e);
    } finally {
      setRunningId(null);
    }
  };

  const handleClickTask = (task: ScheduledTask) => {
    if (task.threadId) {
      navigate(`/t/${task.threadId}`);
    }
  };

  const formatTime = (ts?: number): string => {
    if (!ts) return '—';
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(ts));
    } catch {
      return '—';
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--c-bg-page)]">
        <div className="text-sm text-[var(--c-text-secondary)]">{t.commonLoading}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-[var(--c-bg-page)]" data-testid="scheduled-page">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--c-border)] px-8 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="rounded-lg p-1 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <h2 className="text-lg font-medium text-[var(--c-text-primary)]">{t.scheduledTitle}</h2>
            <p className="text-xs text-[var(--c-text-secondary)] mt-0.5">
              {t.scheduledSubtitle}
            </p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--c-btn-bg)] px-3.5 py-1.5 text-sm font-medium text-[var(--c-btn-text)] transition-[filter] duration-150 hover:brightness-[1.12] active:brightness-[0.95]"
        >
          <Plus size={15} />
          {t.scheduledNew}
        </button>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-8 py-4">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Clock size={48} className="mb-4 text-[var(--c-text-tertiary)] opacity-50" />
            <p className="text-sm text-[var(--c-text-secondary)]">{t.scheduledEmpty}</p>
            <p className="mt-2 text-xs text-[var(--c-text-tertiary)]">
              {t.scheduledEmptyDesc}
            </p>
            <button
              onClick={openCreate}
              className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
            >
              <Plus size={16} />
              {t.scheduledCreateFirst}
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-[700px] flex flex-col gap-3">
            {tasks.map(task => (
              <div
                key={task.id}
                className="rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--c-text-primary)]">{task.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        task.status === 'active'
                          ? 'bg-green-50 text-green-600'
                          : 'bg-[var(--c-bg-deep)] text-[var(--c-text-tertiary)]'
                      }`}>
                        {task.status === 'active' ? t.scheduledActive : t.scheduledPaused}
                      </span>
                      <span className="text-xs text-[var(--c-text-tertiary)]">
                        {frequencyLabels[task.frequency] || task.frequency}
                      </span>
                    </div>
                    {task.description && (
                      <p className="mt-1 text-xs text-[var(--c-text-secondary)] line-clamp-1">{task.description}</p>
                    )}
                    <div className="mt-2 flex gap-4 text-xs text-[var(--c-text-tertiary)]">
                      <span>Last run: {formatTime(task.lastRunAt)}</span>
                      {task.nextRunAt && <span>Next: {formatTime(task.nextRunAt)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleRun(task)}
                      disabled={runningId === task.id}
                      className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                        runningId === task.id
                          ? 'text-[var(--c-text-tertiary)] cursor-wait'
                          : 'text-[var(--c-accent)] hover:bg-[var(--c-accent)]/10'
                      }`}
                      title={t.scheduledRun}
                    >
                      <Play size={12} />
                      {t.scheduledRun}
                    </button>
                    {task.threadId && (
                      <button
                        onClick={() => handleClickTask(task)}
                        className="rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
                        title={t.scheduledView}
                      >
                        {t.scheduledView}
                      </button>
                    )}
                    {task.threadId && (
                      <button
                        onClick={() => handleDeleteInstance(task.id)}
                        className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-red-500 hover:bg-red-50 transition-colors"
                        title={t.scheduledDeleteInstanceTitle}
                      >
                        <XCircle size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => handleToggle(task)}
                      className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                        task.status === 'active'
                          ? 'text-yellow-600 hover:bg-yellow-50'
                          : 'text-green-600 hover:bg-green-50'
                      }`}
                    >
                      {task.status === 'active' ? t.scheduledPause : t.scheduledResume}
                    </button>
                    <button
                      onClick={() => openEdit(task)}
                      className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-[var(--c-text-primary)] hover:bg-[var(--c-bg-deep)] transition-colors"
                      title={t.commonEdit}
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-red-500 hover:bg-red-50 transition-colors"
                      title={t.commonDelete}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closeModal}>
          <div
            className="mx-4 w-full max-w-[600px] rounded-2xl bg-[var(--c-bg-card)] shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-[var(--c-border)] px-6 py-4">
              <h3 className="text-base font-medium text-[var(--c-text-primary)]">
                {modalMode === 'create' ? t.scheduledCreateTitle : t.scheduledEditTitle}
              </h3>
              <button
                onClick={closeModal}
                className="rounded-lg p-1 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal body */}
            <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Name + Description row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">
                    {t.scheduledName} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="每日简报"
                    className="w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">
                    {t.scheduledDescription} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    placeholder="汇总日历和收件箱"
                    className="w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
                  />
                </div>
              </div>

              {/* Prompt textarea */}
              <div>
                <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">
                  {t.scheduledInstructions} <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={formPrompt}
                  onChange={e => setFormPrompt(e.target.value)}
                  placeholder="查看今天的日历会议并汇总未读邮件，标记紧急事项。"
                  rows={4}
                  className="w-full resize-none rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
                />
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.scheduledFrequency}</label>
                <div className="relative">
                  <select
                    value={formFrequency}
                    onChange={e => {
                      setFormFrequency(e.target.value as never);
                      setFormScheduleConfig({});
                    }}
                    className="w-full appearance-none rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)] pr-8"
                  >
                    {FREQUENCY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{frequencyLabels[opt.value] || opt.value}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                    <svg className="h-4 w-4 text-[var(--c-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Schedule config - conditional time picker */}
              {formFrequency === 'hourly' && (
                <div>
                  <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.scheduledInterval}</label>
                  <div className="relative">
                    <select
                      value={formScheduleConfig?.intervalMinutes || 60}
                      onChange={e => setFormScheduleConfig({ ...formScheduleConfig, intervalMinutes: Number(e.target.value) })}
                      className="w-full appearance-none rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)] pr-8"
                    >
                      {INTERVAL_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{intervalLabels[opt.value] || String(opt.value)}</option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                      <svg className="h-4 w-4 text-[var(--c-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>
              )}

              {(formFrequency === 'daily' || formFrequency === 'weekdays') && (
                <div>
                  <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.scheduledRunAt}</label>
                  <input
                    type="time"
                    value={`${String(formScheduleConfig?.hour ?? 9).padStart(2, '0')}:${String(formScheduleConfig?.minute ?? 0).padStart(2, '0')}`}
                    onChange={e => {
                      const [h, m] = e.target.value.split(':').map(Number);
                      setFormScheduleConfig({ ...formScheduleConfig, hour: h, minute: m });
                    }}
                    className="w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
                  />
                </div>
              )}

              {formFrequency === 'weekly' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.scheduledDayOfWeek}</label>
                    <div className="flex gap-1">
                      {DAY_OPTIONS.map(day => (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => setFormScheduleConfig({ ...formScheduleConfig, dayOfWeek: day.value })}
                          className={`flex-1 rounded-lg py-1.5 text-xs transition-colors ${
                            (formScheduleConfig?.dayOfWeek ?? 1) === day.value
                              ? 'bg-[var(--c-accent)] text-white'
                              : 'border border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
                          }`}
                        >
                          {dayLabels[day.value] || String(day.value)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.scheduledRunAt}</label>
                    <input
                      type="time"
                      value={`${String(formScheduleConfig?.hour ?? 9).padStart(2, '0')}:${String(formScheduleConfig?.minute ?? 0).padStart(2, '0')}`}
                      onChange={e => {
                        const [h, m] = e.target.value.split(':').map(Number);
                        setFormScheduleConfig({ ...formScheduleConfig, hour: h, minute: m });
                      }}
                      className="w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 border-t border-[var(--c-border)] px-6 py-4">
              <button
                onClick={closeModal}
                className="rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
              >
                {t.scheduledCancel}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim() || !formPrompt.trim()}
                className="rounded-lg bg-[var(--c-accent)] px-5 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {saving ? t.scheduledSaving : t.scheduledSave}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete definition confirmation */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 10000, background: 'rgba(0,0,0,0.12)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDeleteId(null); }}
        >
          <div
            style={{
              background: 'var(--c-bg-page)',
              border: '0.5px solid var(--c-border-subtle)',
              borderRadius: '16px',
              padding: '24px',
              width: '320px',
              boxShadow: 'var(--c-dropdown-shadow)',
            }}
          >
            <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--c-text-primary)', marginBottom: '8px' }}>
              {t.scheduledDeleteTitle}
            </p>
            <p style={{ fontSize: '13px', color: 'var(--c-text-secondary)', lineHeight: 1.55, marginBottom: '20px' }}>
              {t.scheduledDeleteBody}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="hover:bg-[var(--c-bg-deep)]"
                style={{ padding: '7px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--c-text-secondary)', background: 'transparent', border: '0.5px solid var(--c-border-subtle)', cursor: 'pointer' }}
              >
                {t.scheduledCancel}
              </button>
              <button
                onClick={confirmDelete}
                className="hover:opacity-85 active:opacity-70"
                style={{ padding: '7px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, color: '#fff', background: '#ef4444', border: 'none', cursor: 'pointer' }}
              >
                {t.scheduledDeleteConfirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete instance confirmation */}
      {confirmDeleteInstanceId && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 10000, background: 'rgba(0,0,0,0.12)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDeleteInstanceId(null); }}
        >
          <div
            style={{
              background: 'var(--c-bg-page)',
              border: '0.5px solid var(--c-border-subtle)',
              borderRadius: '16px',
              padding: '24px',
              width: '320px',
              boxShadow: 'var(--c-dropdown-shadow)',
            }}
          >
            <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--c-text-primary)', marginBottom: '8px' }}>
              {t.scheduledDeleteInstanceTitle}
            </p>
            <p style={{ fontSize: '13px', color: 'var(--c-text-secondary)', lineHeight: 1.55, marginBottom: '20px' }}>
              {t.scheduledDeleteInstanceBody}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDeleteInstanceId(null)}
                className="hover:bg-[var(--c-bg-deep)]"
                style={{ padding: '7px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--c-text-secondary)', background: 'transparent', border: '0.5px solid var(--c-border-subtle)', cursor: 'pointer' }}
              >
                {t.scheduledCancel}
              </button>
              <button
                onClick={confirmDeleteInstance}
                className="hover:opacity-85 active:opacity-70"
                style={{ padding: '7px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, color: '#fff', background: '#ef4444', border: 'none', cursor: 'pointer' }}
              >
                {t.scheduledDeleteInstanceConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
