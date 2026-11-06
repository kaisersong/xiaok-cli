import {useEffect} from 'react';
import {getDesktopApi} from '@xiaok/shared/desktop';
import type {ScheduledTaskDueEvent} from '../../../shared/scheduled-task-due-event';
import {reportScheduledReadFailure} from '../lib/scheduled-timed-action-error';
import {collectScheduledRuntimeTaskIds, ensureAggregatedScheduledThread, mergeScheduledTaskCache} from '../lib/scheduled-task-threads';

const STORAGE_KEY = 'xiaok:scheduled-tasks';
const DELIVERED_KEY = 'xiaok:scheduled-delivered-runs';

/** Main owns runtime facts; this single root hook projects their durable links into the UI. */
export function useScheduledTaskBootstrap(): void {
  useEffect(() => {
    const desktop = getDesktopApi();
    if (!desktop?.onScheduledTaskDue) return;
    let active = true;
    let queue = Promise.resolve();
    const enqueue = (work: () => Promise<void>) => {
      queue = queue.then(async () => {if (active) await work();}).catch(() => {if (active) reportScheduledReadFailure();});
      return queue;
    };
    const readCache = () => {
      const rows = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (!Array.isArray(rows)) throw Error('scheduled_cache_invalid');
      return rows;
    };
    const link = async (task: any) => {
      if (!task.runtimeTaskId && !task.threadId?.startsWith('task_')) return task;
      const runs = desktop.getTimedActionRuns ? await desktop.getTimedActionRuns(task.id) : [];
      if (!Array.isArray(runs)) throw Error('scheduled_runs_invalid');
      if (!active) return task;
      return ensureAggregatedScheduledThread(task, collectScheduledRuntimeTaskIds(task, runs));
    };
    const updated = () => window.dispatchEvent(new CustomEvent('xiaok:scheduled-tasks-updated'));

    const notify = (payload: ScheduledTaskDueEvent, fallbackTitle = '') => {
      const identity = payload.runId ? `${payload.taskId}:${payload.runId}` : undefined;
      const delivered: string[] = JSON.parse(localStorage.getItem(DELIVERED_KEY) ?? '[]');
      if (identity && delivered.includes(identity)) return;
      const unread = JSON.parse(localStorage.getItem('xiaok:scheduled-unread') ?? '{}');
      unread[payload.taskId] = (unread[payload.taskId] ?? 0) + 1;
      localStorage.setItem('xiaok:scheduled-unread', JSON.stringify(unread));
      if (identity) localStorage.setItem(DELIVERED_KEY, JSON.stringify([...delivered, identity].slice(-500)));
      window.dispatchEvent(new CustomEvent('xiaok:scheduled-unread-changed'));
      window.dispatchEvent(new CustomEvent('xiaok:scheduled-toast', {detail: {
        taskId: payload.taskId, title: payload.title ?? fallbackTitle,
        success: payload.completed === true && payload.success === true, error: payload.error,
      }}));
    };
    const unsub = desktop.onScheduledTaskDue((payload: ScheduledTaskDueEvent) => enqueue(async () => {
      let rows = readCache();
      let index = rows.findIndex((task: any) => task.id === payload.taskId);
      if (index < 0 && desktop.getScheduledTasks) {
        const main = await desktop.getScheduledTasks();
        if (!Array.isArray(main)) throw Error('scheduled_tasks_invalid');
        rows = mergeScheduledTaskCache(main, rows);
        index = rows.findIndex((task: any) => task.id === payload.taskId);
      }
      if (index < 0 || !active) return;
      const task = {...rows[index], ...(payload.runtimeTaskId ? {runtimeTaskId: payload.runtimeTaskId} : {})};
      const linked = await link(task);
      if (!active) return;
      rows[index] = {...linked,
        lastRunAt: Math.max(task.lastRunAt ?? 0, payload.lastRunAt ?? 0),
        nextRunAt: payload.nextRunAt ?? task.nextRunAt,
        updatedAt: Math.max(task.updatedAt ?? 0, payload.lastRunAt ?? 0),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
      updated();
      const dispatchFailed = payload.dispatchStatus === 'failed' || payload.dispatchStatus === 'skipped';
      if (!payload.completed && !dispatchFailed) return;
      notify(payload, task.name ?? '');
    }));

    // Register before the initial read, and serialize it with live events.
    if (desktop.getScheduledTasks) void enqueue(async () => {
      const recoveredNotices = desktop.getRecentScheduledDeliveries ? await desktop.getRecentScheduledDeliveries() : [];
      if (!Array.isArray(recoveredNotices)) throw Error('scheduled_deliveries_invalid');
      const main = await desktop.getScheduledTasks();
      if (!Array.isArray(main)) throw Error('scheduled_tasks_invalid');
      const rows = mergeScheduledTaskCache(main, readCache());
      const linked = [];
      for (const row of rows) {
        if (!active) return;
        linked.push(await link(row));
      }
      if (!active) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(linked));
      updated();
      for (const notice of recoveredNotices) {if (!active) return; notify(notice);}
    });
    return () => {active = false; unsub();};
  }, []);
}
