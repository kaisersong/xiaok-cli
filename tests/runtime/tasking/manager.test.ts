import { describe, expect, it, vi } from 'vitest';
import { SerialTaskManager } from '../../../src/runtime/tasking/manager.js';
import { InMemoryTaskStore } from '../../../src/runtime/tasking/store.js';
import { waitFor } from '../../support/wait-for.js';

interface DemoRequest {
  message: string;
}

interface DemoTask {
  taskId: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_approval';
  prompt: string;
  replyLength?: number;
  replySummary?: string;
  errorMessage?: string;
  latestEvent?: string;
  startedAt?: number;
  finishedAt?: number;
}

describe('runtime task manager', () => {
  it('runs session tasks serially and tracks the active task', async () => {
    const notify = vi.fn(async () => undefined);
    const executionOrder: string[] = [];
    const gate: Array<() => void> = [];
    const store = new InMemoryTaskStore<DemoTask, { sessionId: string; prompt: string }>((taskId, now, input) => ({
      taskId,
      sessionId: input.sessionId,
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      prompt: input.prompt,
    }));

    const manager = new SerialTaskManager({
      store,
      createTaskInput: (request, sessionId) => ({
        sessionId,
        prompt: request.message,
      }),
      buildAckMessage: (task) => `ack ${task.taskId}`,
      buildCompletionSummary: (task) => `done ${task.taskId}`,
      notify,
      execute: async ({ request }) => {
        executionOrder.push(`start:${request.message}`);
        await new Promise<void>((resolve) => {
          gate.push(resolve);
        });
        executionOrder.push(`end:${request.message}`);
        return {
          ok: true,
          generationMs: 1,
          deliveryMs: 1,
          replyLength: request.message.length,
          replyPreview: request.message,
        };
      },
    });

    const first = await manager.createAndStart({ message: 'first' }, 'sess_1');
    const second = await manager.createAndStart({ message: 'second' }, 'sess_1');

    await waitFor(() => {
      expect(manager.getActiveTask('sess_1')?.taskId).toBe(first.taskId);
    });

    expect(executionOrder).toEqual(['start:first']);
    gate.shift()?.();

    await waitFor(() => {
      expect(manager.getTask(first.taskId)?.status).toBe('completed');
      expect(manager.getActiveTask('sess_1')?.taskId).toBe(second.taskId);
    });

    gate.shift()?.();

    await waitFor(() => {
      expect(manager.getTask(second.taskId)?.status).toBe('completed');
    });

    expect(executionOrder).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    expect(notify).toHaveBeenCalledWith({ message: 'first' }, 'ack task_1');
    expect(notify).toHaveBeenCalledWith({ message: 'second' }, 'ack task_2');
  });

  it('cancels a running task and marks it cancelled', async () => {
    const store = new InMemoryTaskStore<DemoTask, { sessionId: string; prompt: string }>((taskId, now, input) => ({
      taskId,
      sessionId: input.sessionId,
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      prompt: input.prompt,
    }));

    const manager = new SerialTaskManager({
      store,
      createTaskInput: (request, sessionId) => ({
        sessionId,
        prompt: request.message,
      }),
      buildAckMessage: (task) => `ack ${task.taskId}`,
      buildCompletionSummary: (task) => `done ${task.taskId}`,
      notify: async () => undefined,
      execute: async ({ signal }) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return {
          ok: false,
          cancelled: true,
          generationMs: 0,
          deliveryMs: 0,
          replyLength: 0,
          errorMessage: 'aborted',
        };
      },
    });

    const task = await manager.createAndStart({ message: 'long task' }, 'sess_1');

    await waitFor(() => {
      expect(manager.getTask(task.taskId)?.status).toBe('running');
    });

    expect(manager.cancelTask(task.taskId)).toMatchObject({
      ok: true,
      message: `任务 ${task.taskId} 已取消`,
    });

    await waitFor(() => {
      expect(manager.getTask(task.taskId)?.status).toBe('cancelled');
    });
  });
});
