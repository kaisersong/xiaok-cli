/**
 * useScheduledTaskBootstrap — global hook that syncs scheduled tasks to main process
 * on app startup and listens for task execution notifications to refresh UI.
 *
 * Architecture: Main process is the Single Source of Truth for task state.
 * Renderer no longer bulk-syncs localStorage into main. It only listens for
 * main-process execution notifications and refreshes UI cache.
 *
 * Must be mounted once at the app root level (App.tsx).
 */

import { useEffect } from 'react';
import { api } from '../api';

const STORAGE_KEY = 'xiaok:scheduled-tasks';

export function useScheduledTaskBootstrap(): void {
  useEffect(() => {
    const desktop = (window as any).xiaokDesktop;
    if (!desktop?.onScheduledTaskDue) return;

    // Listen for task execution notifications from main — trust main's state
    const unsub = desktop.onScheduledTaskDue(async (payload: {
      taskId: string;
      runtimeTaskId?: string;
      completed?: boolean;
      success?: boolean;
      lastRunAt?: number;
      nextRunAt?: number;
    }) => {
      if (!payload.completed) return;
      const raw = localStorage.getItem(STORAGE_KEY);
      const currentTasks = raw ? JSON.parse(raw) : [];
      const idx = currentTasks.findIndex((t: any) => t.id === payload.taskId);
      if (idx === -1) return;

      // Use authoritative state from main process — no local recalculation
      if (payload.success && payload.lastRunAt) {
        const task = currentTasks[idx];

        // Associate auto-execution result with a thread
        if (payload.runtimeTaskId) {
          try {
            let threadId = task.threadId;
            if (threadId) {
              await api.updateThreadTaskId(threadId, payload.runtimeTaskId);
            } else {
              const thread = await api.createThread({ title: (task.name || '').slice(0, 40) });
              await api.updateThreadTaskId(thread.id, payload.runtimeTaskId);
              threadId = thread.id;
            }
            task.threadId = threadId;
          } catch { /* ignore thread errors */ }
        }

        currentTasks[idx] = {
          ...task,
          lastRunAt: payload.lastRunAt,
          nextRunAt: payload.nextRunAt,
          updatedAt: payload.lastRunAt,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentTasks));
      }
      window.dispatchEvent(new CustomEvent('xiaok:scheduled-tasks-updated'));
    });

    return unsub;
  }, []);
}
