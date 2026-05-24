import { describe, expect, it, vi } from 'vitest';

import {
  collectScheduledRuntimeTaskIds,
  ensureAggregatedScheduledThread,
  type ScheduledThreadApi,
  type ScheduledThreadRecord,
} from '../../renderer/src/lib/scheduled-task-threads';

function createFakeThreadApi(initialThreads: ScheduledThreadRecord[]): ScheduledThreadApi & {
  createThread: ReturnType<typeof vi.fn>;
  updateThreadTaskId: ReturnType<typeof vi.fn>;
  threads: Map<string, ScheduledThreadRecord>;
} {
  const threads = new Map(initialThreads.map(thread => [thread.id, {
    ...thread,
    taskIds: [...(thread.taskIds ?? [])],
  }]));

  const fakeApi: ScheduledThreadApi & {
    createThread: ReturnType<typeof vi.fn>;
    updateThreadTaskId: ReturnType<typeof vi.fn>;
    threads: Map<string, ScheduledThreadRecord>;
  } = {
    threads,
    async getThread(id: string) {
      return threads.get(id) ?? null;
    },
    async listThreads() {
      return Array.from(threads.values());
    },
    createThread: vi.fn(async (input: { title?: string }) => {
      const thread: ScheduledThreadRecord = {
        id: `thread-${threads.size + 1}`,
        title: input.title ?? null,
        currentTaskId: null,
        taskIds: [],
        createdAt: 100 + threads.size,
        updatedAt: 100 + threads.size,
      };
      threads.set(thread.id, thread);
      return thread;
    }),
    updateThreadTaskId: vi.fn(async (id: string, taskId: string) => {
      const thread = threads.get(id);
      if (!thread) throw new Error(`missing thread ${id}`);
      if (!thread.taskIds.includes(taskId)) thread.taskIds.push(taskId);
      thread.currentTaskId = taskId;
      thread.updatedAt = (thread.updatedAt ?? 0) + 1;
    }),
  };

  return fakeApi;
}

describe('scheduled task thread aggregation', () => {
  it('collects runtime task ids from scheduled task runs in chronological order', () => {
    expect(collectScheduledRuntimeTaskIds(
      { runtimeTaskId: 'task_latest' },
      [
        { runtimeTaskId: 'task_latest', startedAt: 300 },
        { runtimeTaskId: 'task_oldest', startedAt: 100 },
        { runtimeTaskId: 'task_middle', startedAt: 200 },
        { runtimeTaskId: 'not_a_runtime', startedAt: 250 },
      ],
    )).toEqual(['task_oldest', 'task_middle', 'task_latest']);
  });

  it('reuses the scheduled task thread and appends new runtime task ids instead of creating a recent-list thread', async () => {
    const fakeApi = createFakeThreadApi([
      {
        id: 'thread-dream',
        title: 'Dream',
        currentTaskId: 'task_old',
        taskIds: ['task_old'],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const linked = await ensureAggregatedScheduledThread({
      id: 'scheduled-dream',
      name: 'Dream',
      threadId: 'thread-dream',
      runtimeTaskId: 'task_new',
    }, ['task_old', 'task_new'], fakeApi);

    expect(linked.threadId).toBe('thread-dream');
    expect(fakeApi.createThread).not.toHaveBeenCalled();
    expect(fakeApi.threads.get('thread-dream')?.taskIds).toEqual(['task_old', 'task_new']);
    expect(fakeApi.threads.get('thread-dream')?.currentTaskId).toBe('task_new');
  });

  it('adopts an existing scheduled runtime thread and backfills other runs into it', async () => {
    const fakeApi = createFakeThreadApi([
      {
        id: 'thread-new-run',
        title: 'Dream',
        currentTaskId: 'task_new',
        taskIds: ['task_new'],
        createdAt: 10,
        updatedAt: 10,
      },
      {
        id: 'thread-old-run',
        title: 'Dream',
        currentTaskId: 'task_old',
        taskIds: ['task_old'],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const linked = await ensureAggregatedScheduledThread({
      id: 'scheduled-dream',
      name: 'Dream',
      runtimeTaskId: 'task_new',
    }, ['task_old', 'task_new'], fakeApi);

    expect(linked.threadId).toBe('thread-new-run');
    expect(fakeApi.createThread).not.toHaveBeenCalled();
    expect(fakeApi.threads.get('thread-new-run')?.taskIds).toEqual(['task_new', 'task_old']);
  });
});
