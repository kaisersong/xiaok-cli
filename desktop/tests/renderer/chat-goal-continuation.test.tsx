import { describe, expect, it, vi } from 'vitest';
import { attachPreparedGoalTask } from '../../renderer/src/lib/goal-task-attachment';

describe('Goal continuation attachment', () => {
  it('updates the thread and subscribes before acknowledging the exact attachment', async () => {
    const order: string[] = [];
    await attachPreparedGoalTask({
      prepared: { threadId: 'thread_1', taskId: 'task_1', attachmentId: 'attachment_1' },
      currentThreadId: 'thread_1',
      updateThreadTaskId: async () => { order.push('update'); },
      subscribeTask: () => { order.push('subscribe'); return () => undefined; },
      onEvent: vi.fn(),
      ackGoalTaskAttached: async () => { order.push('ack'); },
    });
    expect(order).toEqual(['update', 'subscribe', 'ack']);
  });

  it('ignores another thread and does not acknowledge it', async () => {
    const ack = vi.fn();
    const result = await attachPreparedGoalTask({
      prepared: { threadId: 'thread_other', taskId: 'task_1', attachmentId: 'attachment_1' },
      currentThreadId: 'thread_1', updateThreadTaskId: vi.fn(), subscribeTask: vi.fn(),
      onEvent: vi.fn(), ackGoalTaskAttached: ack,
    });
    expect(result).toBeNull();
    expect(ack).not.toHaveBeenCalled();
  });
});
