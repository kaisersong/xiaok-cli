import { useState, useEffect } from 'react';
import { Plus, X, Clock, Edit3, Trash2, Play, ChevronLeft, Settings as SettingsIcon } from 'lucide-react';
import { api, type ThreadRecord } from '../api';
import { useNavigate } from 'react-router-dom';

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
}

type ModalMode = 'create' | 'edit' | null;

const FREQUENCY_OPTIONS = [
  { value: 'manual' as const, label: 'Manual' },
  { value: 'hourly' as const, label: 'Hourly' },
  { value: 'daily' as const, label: 'Daily' },
  { value: 'weekdays' as const, label: 'Weekdays' },
  { value: 'weekly' as const, label: 'Weekly' },
];

// Scheduled task context prefix — placed at the START of prompt so LLM sees it first
const SCHEDULED_CONTEXT_PREFIX = `[SYSTEM: This is a scheduled/automated task. ` +
  `The user set this up to run automatically. ` +
  `Please provide a friendly, concise reminder response.]\n\n`;

export function ScheduledPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formFrequency, setFormFrequency] = useState<'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly'>('manual');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTasks();

    // Listen for reminder events from main process
    const handler = () => loadTasks();
    window.addEventListener('desktop:reminder', handler);
    return () => window.removeEventListener('desktop:reminder', handler);
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
  };

  const openCreate = () => {
    setFormName('');
    setFormDesc('');
    setFormPrompt('');
    setFormFrequency('manual');
    setEditingTask(null);
    setModalMode('create');
  };

  const openEdit = (task: ScheduledTask) => {
    setFormName(task.name);
    setFormDesc(task.description);
    setFormPrompt(task.prompt);
    setFormFrequency(task.frequency);
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
    if (modalMode === 'create') {
      const newTask: ScheduledTask = {
        id: crypto.randomUUID(),
        name: formName.trim(),
        description: formDesc.trim(),
        prompt: formPrompt.trim(),
        frequency: formFrequency,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      saveTasks([newTask, ...tasks]);
    } else if (editingTask) {
      const updated = tasks.map(t =>
        t.id === editingTask.id
          ? { ...t, name: formName.trim(), description: formDesc.trim(), prompt: formPrompt.trim(), frequency: formFrequency, updatedAt: now }
          : t
      );
      saveTasks(updated);
    }

    setSaving(false);
    closeModal();
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this scheduled task?')) return;
    saveTasks(tasks.filter(t => t.id !== id));
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

      // Update task record
      saveTasks(tasks.map(t =>
        t.id === task.id
          ? { ...t, lastRunAt: Date.now(), updatedAt: Date.now(), threadId }
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
        <div className="text-sm text-[var(--c-text-secondary)]">Loading...</div>
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
            <h2 className="text-lg font-medium text-[var(--c-text-primary)]">Scheduled Tasks</h2>
            <p className="text-xs text-[var(--c-text-secondary)] mt-0.5">
              Manage automated tasks that run on a schedule
            </p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-[var(--c-accent)] px-4 py-2 text-sm text-white hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          New task
        </button>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-8 py-4">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Clock size={48} className="mb-4 text-[var(--c-text-tertiary)] opacity-50" />
            <p className="text-sm text-[var(--c-text-secondary)]">No scheduled tasks</p>
            <p className="mt-2 text-xs text-[var(--c-text-tertiary)]">
              Create a task to automate repetitive work
            </p>
            <button
              onClick={openCreate}
              className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
            >
              <Plus size={16} />
              Create your first task
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
                        {task.status === 'active' ? 'Active' : 'Paused'}
                      </span>
                      <span className="text-xs text-[var(--c-text-tertiary)]">
                        {FREQUENCY_OPTIONS.find(f => f.value === task.frequency)?.label || task.frequency}
                      </span>
                    </div>
                    {task.description && (
                      <p className="mt-1 text-xs text-[var(--c-text-secondary)] line-clamp-1">{task.description}</p>
                    )}
                    <div className="mt-2 text-xs text-[var(--c-text-tertiary)]">
                      Last run: {formatTime(task.lastRunAt)}
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
                      title="Run now"
                    >
                      <Play size={12} />
                      Run
                    </button>
                    {task.threadId && (
                      <button
                        onClick={() => handleClickTask(task)}
                        className="rounded-lg px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
                        title="View last run"
                      >
                        View
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
                      {task.status === 'active' ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => openEdit(task)}
                      className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-[var(--c-text-primary)] hover:bg-[var(--c-bg-deep)] transition-colors"
                      title="Edit"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Delete"
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
                {modalMode === 'create' ? 'Create scheduled task' : 'Edit scheduled task'}
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
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="daily-briefing"
                    className="w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    placeholder="Summarize my calendar and inbox"
                    className="w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
                  />
                </div>
              </div>

              {/* Prompt textarea */}
              <div>
                <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">
                  Instructions <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={formPrompt}
                  onChange={e => setFormPrompt(e.target.value)}
                  placeholder="Check my calendar for today's meetings and summarize my unread emails. Highlight anything urgent."
                  rows={4}
                  className="w-full resize-none rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
                />
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">Frequency</label>
                <div className="relative">
                  <select
                    value={formFrequency}
                    onChange={e => setFormFrequency(e.target.value as never)}
                    className="w-full appearance-none rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)] pr-8"
                  >
                    {FREQUENCY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                    <svg className="h-4 w-4 text-[var(--c-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 border-t border-[var(--c-border)] px-6 py-4">
              <button
                onClick={closeModal}
                className="rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim() || !formPrompt.trim()}
                className="rounded-lg bg-[var(--c-accent)] px-5 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
