import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface ToastItem {
  id: number;
  taskId: string;
  title: string;
  success: boolean;
  error?: string;
}

export function ScheduledTaskToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    let counter = 0;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        taskId: string;
        title: string;
        success: boolean;
        error?: string;
      };
      const id = ++counter;
      setToasts(prev => [...prev, { id, ...detail }]);
      const timer = setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 8000);
      return () => clearTimeout(timer);
    };
    window.addEventListener('xiaok:scheduled-toast', handler);
    return () => window.removeEventListener('xiaok:scheduled-toast', handler);
  }, []);

  const dismiss = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  const openTask = (taskId: string, id: number) => {
    try {
      const raw = localStorage.getItem('xiaok:scheduled-tasks');
      const tasks = raw ? JSON.parse(raw) : [];
      const task = Array.isArray(tasks) ? tasks.find((t: { id?: string }) => t.id === taskId) : null;
      const threadId = task?.threadId;
      if (threadId && typeof threadId === 'string' && !threadId.startsWith('task_')) {
        navigate(`/t/${threadId}`);
      } else {
        navigate('/automations/schedules');
      }
    } catch {
      navigate('/automations/schedules');
    }
    // Clear unread marker for this task
    try {
      const unreadRaw = localStorage.getItem('xiaok:scheduled-unread');
      const unread: Record<string, number> = unreadRaw ? JSON.parse(unreadRaw) : {};
      delete unread[taskId];
      localStorage.setItem('xiaok:scheduled-unread', JSON.stringify(unread));
      window.dispatchEvent(new CustomEvent('xiaok:scheduled-unread-changed'));
    } catch { /* best-effort */ }
    dismiss(id);
  };

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[9999] flex flex-col gap-2">
      {toasts.map(toast => (
        <button
          key={toast.id}
          type="button"
          onClick={() => openTask(toast.taskId, toast.id)}
          className="pointer-events-auto flex w-[320px] items-start gap-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-4 py-3 text-left shadow-lg transition-all hover:bg-[var(--c-bg-deep)]"
        >
          <div
            className={`mt-1 size-2 shrink-0 rounded-full ${
              toast.success ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[var(--c-text-primary)]">
              {toast.success ? '定时任务已完成' : '定时任务失败'}
            </div>
            <div className="mt-0.5 truncate text-xs text-[var(--c-text-secondary)]">
              {toast.title || toast.taskId}
            </div>
            {!toast.success && toast.error && (
              <div className="mt-1 line-clamp-2 text-xs text-[var(--c-text-tertiary)]">
                {toast.error}
              </div>
            )}
            <div className="mt-1 text-[11px] text-[var(--c-text-tertiary)]">
              点击查看
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
            className="shrink-0 text-[var(--c-text-tertiary)] hover:text-[var(--c-text-primary)]"
            aria-label="关闭"
          >
            ×
          </button>
        </button>
      ))}
    </div>
  );
}
