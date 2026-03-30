import { describe, expect, it } from 'vitest';
import { InMemoryTaskStore } from '../../../src/runtime/tasking/store.js';

interface DemoTask {
  taskId: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_approval';
  prompt: string;
}

describe('runtime task store', () => {
  it('creates, updates, and lists tasks with stable newest-first ordering', () => {
    const store = new InMemoryTaskStore<DemoTask, { sessionId: string; prompt: string }>((taskId, now, input) => ({
      taskId,
      sessionId: input.sessionId,
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      prompt: input.prompt,
    }));

    const first = store.create({ sessionId: 'sess_1', prompt: 'first' });
    const second = store.create({ sessionId: 'sess_1', prompt: 'second' });

    store.update(first.taskId, { status: 'completed' });

    expect(store.get(first.taskId)).toMatchObject({
      taskId: first.taskId,
      status: 'completed',
    });
    expect(store.listBySession('sess_1').map((task) => task.taskId)).toEqual([
      second.taskId,
      first.taskId,
    ]);
  });
});
