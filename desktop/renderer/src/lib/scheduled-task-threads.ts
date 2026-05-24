import { api } from '../api';

export interface ScheduledThreadRecord {
  id: string;
  title?: string | null;
  currentTaskId?: string | null;
  taskIds?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface ScheduledThreadApi {
  getThread(id: string): Promise<ScheduledThreadRecord | null>;
  listThreads(options?: { limit?: number }): Promise<ScheduledThreadRecord[]>;
  createThread(input: { title?: string }): Promise<ScheduledThreadRecord>;
  updateThreadTaskId(id: string, taskId: string): Promise<void>;
}

export interface ScheduledTaskRuntimeLink {
  id?: string;
  name?: string;
  description?: string;
  threadId?: string;
  runtimeTaskId?: string;
}

export interface ScheduledTaskRunLink {
  runtimeTaskId?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
}

export function isRuntimeTaskId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('task_');
}

export function normalizeScheduledTaskRuntimeLink<T extends ScheduledTaskRuntimeLink>(
  task: T,
  local?: ScheduledTaskRuntimeLink,
): T {
  const localRuntimeTaskId = local?.runtimeTaskId ?? (isRuntimeTaskId(local?.threadId) ? local?.threadId : undefined);
  const runtimeTaskId = task.runtimeTaskId ?? (isRuntimeTaskId(task.threadId) ? task.threadId : undefined) ?? localRuntimeTaskId;
  const threadId = isRuntimeTaskId(task.threadId)
    ? (local && !isRuntimeTaskId(local.threadId) ? local.threadId : undefined)
    : task.threadId ?? (local && !isRuntimeTaskId(local.threadId) ? local.threadId : undefined);
  return { ...task, runtimeTaskId, threadId };
}

export function mergeScheduledTaskCache<T extends ScheduledTaskRuntimeLink & { id: string }>(
  mainItems: T[],
  localItems: T[],
): T[] {
  const localById = new Map(localItems.map(item => [item.id, item]));
  return mainItems.map(item => {
    const local = localById.get(item.id);
    const normalized = normalizeScheduledTaskRuntimeLink(item, local);
    const mainDescription = typeof normalized.description === 'string' ? normalized.description.trim() : '';
    const localDescription = typeof local?.description === 'string' ? local.description.trim() : '';
    return !mainDescription && localDescription
      ? { ...normalized, description: local!.description }
      : normalized;
  });
}

export function threadHasRuntimeTask(thread: ScheduledThreadRecord, runtimeTaskId: string): boolean {
  return thread.currentTaskId === runtimeTaskId || (thread.taskIds ?? []).includes(runtimeTaskId);
}

export function threadHasAnyRuntimeTask(thread: ScheduledThreadRecord, runtimeTaskIds: Set<string>): boolean {
  if (thread.currentTaskId && runtimeTaskIds.has(thread.currentTaskId)) return true;
  return (thread.taskIds ?? []).some(taskId => runtimeTaskIds.has(taskId));
}

export function collectScheduledRuntimeTaskIds(
  task: ScheduledTaskRuntimeLink,
  runs: unknown[] = [],
): string[] {
  const orderedRuns = runs
    .map((run, index) => {
      const item = isRecord(run) ? run as ScheduledTaskRunLink : {};
      return {
        runtimeTaskId: item.runtimeTaskId,
        order: toNumber(item.startedAt) ?? toNumber(item.finishedAt) ?? index,
        index,
      };
    })
    .filter((run): run is { runtimeTaskId: string; order: number; index: number } => isRuntimeTaskId(run.runtimeTaskId))
    .sort((a, b) => (a.order - b.order) || (a.index - b.index));

  const ids: string[] = [];
  for (const run of orderedRuns) pushUniqueRuntimeTaskId(ids, run.runtimeTaskId);
  if (isRuntimeTaskId(task.runtimeTaskId)) pushUniqueRuntimeTaskId(ids, task.runtimeTaskId);
  if (isRuntimeTaskId(task.threadId)) pushUniqueRuntimeTaskId(ids, task.threadId);
  return ids;
}

export async function ensureAggregatedScheduledThread<T extends ScheduledTaskRuntimeLink>(
  task: T,
  runtimeTaskIds: string[],
  threadApi: ScheduledThreadApi = api,
): Promise<T> {
  const ids = runtimeTaskIds.filter(isRuntimeTaskId).filter((id, index, all) => all.indexOf(id) === index);
  const normalized = normalizeScheduledTaskRuntimeLink(task);
  if (ids.length === 0) return normalized;

  const preferredThreadId = normalized.threadId && !isRuntimeTaskId(normalized.threadId)
    ? normalized.threadId
    : undefined;
  if (preferredThreadId) {
    const existing = await threadApi.getThread(preferredThreadId).catch(() => null);
    if (existing) {
      await attachRuntimeTaskIds(existing, ids, threadApi);
      return {
        ...normalized,
        threadId: existing.id,
        runtimeTaskId: ids[ids.length - 1],
      };
    }
  }

  const threads = await threadApi.listThreads({ limit: 1000 }).catch(() => []);
  const existing = chooseBestThreadForRuntimeIds(threads, ids);
  if (existing) {
    await attachRuntimeTaskIds(existing, ids, threadApi);
    return {
      ...normalized,
      threadId: existing.id,
      runtimeTaskId: ids[ids.length - 1],
    };
  }

  const created = await threadApi.createThread({ title: (normalized.name || '').slice(0, 40) });
  await attachRuntimeTaskIds(created, ids, threadApi);
  return {
    ...normalized,
    threadId: created.id,
    runtimeTaskId: ids[ids.length - 1],
  };
}

function chooseBestThreadForRuntimeIds(threads: ScheduledThreadRecord[], runtimeTaskIds: string[]): ScheduledThreadRecord | null {
  const latestRuntimeTaskId = runtimeTaskIds[runtimeTaskIds.length - 1];
  const candidates = threads.filter(thread => runtimeTaskIds.some(runtimeTaskId => threadHasRuntimeTask(thread, runtimeTaskId)));
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const aHasLatest = latestRuntimeTaskId && threadHasRuntimeTask(a, latestRuntimeTaskId) ? 1 : 0;
    const bHasLatest = latestRuntimeTaskId && threadHasRuntimeTask(b, latestRuntimeTaskId) ? 1 : 0;
    if (aHasLatest !== bHasLatest) return bHasLatest - aHasLatest;
    return ((b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  })[0];
}

async function attachRuntimeTaskIds(
  thread: ScheduledThreadRecord,
  runtimeTaskIds: string[],
  threadApi: ScheduledThreadApi,
): Promise<void> {
  const taskIds = [...(thread.taskIds ?? [])];
  let currentTaskId = thread.currentTaskId ?? null;
  for (const runtimeTaskId of runtimeTaskIds) {
    if (!threadHasRuntimeTask({ ...thread, taskIds, currentTaskId }, runtimeTaskId)) {
      await threadApi.updateThreadTaskId(thread.id, runtimeTaskId);
      taskIds.push(runtimeTaskId);
      currentTaskId = runtimeTaskId;
    }
  }
  const latestRuntimeTaskId = runtimeTaskIds[runtimeTaskIds.length - 1];
  if (latestRuntimeTaskId && currentTaskId !== latestRuntimeTaskId) {
    await threadApi.updateThreadTaskId(thread.id, latestRuntimeTaskId);
  }
}

function pushUniqueRuntimeTaskId(ids: string[], runtimeTaskId: string): void {
  if (!ids.includes(runtimeTaskId)) ids.push(runtimeTaskId);
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
