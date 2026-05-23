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

function isRuntimeTaskId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('task_');
}

async function findOrCreateThreadForRuntimeTask(taskName: string, runtimeTaskId: string, threadId?: string): Promise<string> {
  if (threadId && !isRuntimeTaskId(threadId)) {
    const existing = await api.getThread(threadId).catch(() => null);
    if (existing && (existing.currentTaskId === runtimeTaskId || (existing.taskIds ?? []).includes(runtimeTaskId))) {
      return threadId;
    }
  }

  const threads = await api.listThreads({ limit: 1000 }).catch(() => []);
  const existing = threads.find(thread => thread.currentTaskId === runtimeTaskId || (thread.taskIds ?? []).includes(runtimeTaskId));
  if (existing) return existing.id;

  const thread = await api.createThread({ title: (taskName || '').slice(0, 40) });
  await api.updateThreadTaskId(thread.id, runtimeTaskId);
  return thread.id;
}

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
      let currentTasks = raw ? JSON.parse(raw) : [];
      let idx = currentTasks.findIndex((t: any) => t.id === payload.taskId);
      if (idx === -1 && desktop.getScheduledTasks) {
        try {
          const mainTasks = await desktop.getScheduledTasks();
          if (Array.isArray(mainTasks)) {
            currentTasks = mainTasks;
            idx = currentTasks.findIndex((t: any) => t.id === payload.taskId);
          }
        } catch { /* keep local cache */ }
      }
      if (idx === -1) return;

      // Use authoritative state from main process — no local recalculation
      if (payload.success && payload.lastRunAt) {
        const task = currentTasks[idx];
        const runtimeTaskId = payload.runtimeTaskId ?? task.runtimeTaskId ?? (isRuntimeTaskId(task.threadId) ? task.threadId : undefined);
        task.runtimeTaskId = runtimeTaskId;
        if (isRuntimeTaskId(task.threadId)) {
          task.threadId = undefined;
        }

        // Associate auto-execution result with a thread
        if (runtimeTaskId) {
          try {
            task.threadId = await findOrCreateThreadForRuntimeTask(task.name, runtimeTaskId, task.threadId);
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
