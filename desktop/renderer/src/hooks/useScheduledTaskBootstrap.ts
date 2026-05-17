/**
 * useScheduledTaskBootstrap — global hook that syncs scheduled tasks to main process
 * on app startup and listens for task execution notifications to refresh UI.
 *
 * Architecture: Main process is the Single Source of Truth for task state.
 * Renderer syncs localStorage → main on startup, then trusts notifications from main
 * for state updates (lastRunAt, nextRunAt).
 *
 * Must be mounted once at the app root level (App.tsx).
 */

import { useEffect } from 'react';

const STORAGE_KEY = 'xiaok:scheduled-tasks';

export function useScheduledTaskBootstrap(): void {
  useEffect(() => {
    const desktop = (window as any).xiaokDesktop;
    if (!desktop?.syncScheduledTasks || !desktop?.onScheduledTaskDue) return;

    // 1. Sync tasks from localStorage to main process scheduler on app startup
    const raw = localStorage.getItem(STORAGE_KEY);
    const tasks = raw ? JSON.parse(raw) : [];
    if (tasks.length > 0) {
      desktop.syncScheduledTasks(tasks).catch(() => {});
    }

    // 2. Listen for task execution notifications from main — trust main's state
    const unsub = desktop.onScheduledTaskDue((payload: {
      taskId: string;
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
        currentTasks[idx] = {
          ...currentTasks[idx],
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
