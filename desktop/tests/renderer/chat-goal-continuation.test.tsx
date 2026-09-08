import { describe, expect, it, vi } from 'vitest';
import { attachPreparedGoalTask } from '../../renderer/src/lib/goal-task-attachment';

describe('Goal continuation attachment', () => {
  it('updates the thread and subscribes before acknowledging the exact attachment', async () => {
    const order: string[] = [];
    await attachPreparedGoalTask({
      prepared: { threadId: 'thread_1', taskId: 'task_1', attachmentId: 'attachment_1' },
      currentThreadId: 'thread_1',
      isCandidateCurrent: () => true,
      onSubscribed: vi.fn(),
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
      isCandidateCurrent: () => true, onSubscribed: vi.fn(),
      onEvent: vi.fn(), ackGoalTaskAttached: ack,
    });
    expect(result).toBeNull();
    expect(ack).not.toHaveBeenCalled();
  });
  it.each(['before-update', 'after-update', 'after-subscribe'] as const)('does not ACK a presentation scope invalidated %s', async stage => {
    let current = stage !== 'before-update';
    const release = vi.fn(), ack = vi.fn();
    const update = vi.fn(async () => { if (stage === 'after-update') current = false; });
    const subscribe = vi.fn(() => { if (stage === 'after-subscribe') current = false; return release; });
    const input = { prepared: { threadId: 'thread_1', taskId: 'task_1', attachmentId: 'attachment_1' }, currentThreadId: 'thread_1',
      isCurrent: () => current, isCandidateCurrent: () => true, onSubscribed: vi.fn(),
      updateThreadTaskId: update, subscribeTask: subscribe, onEvent: vi.fn(), ackGoalTaskAttached: ack };
    expect(await attachPreparedGoalTask(input)).toBeNull(); expect(ack).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(stage === 'before-update' ? 0 : 1);
    expect(subscribe).toHaveBeenCalledTimes(stage === 'after-subscribe' ? 1 : 0);
    expect(release).toHaveBeenCalledTimes(stage === 'after-subscribe' ? 1 : 0);
  });
});
