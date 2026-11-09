import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../renderer/src/api/bridge';
import { recoverForDisplay } from '../../renderer/src/lib/recover-for-display';
import type { TaskSnapshot } from '../../shared/task-types';
const original = window.xiaokDesktop;
afterEach(() => { window.xiaokDesktop = original; });
const snapshot: TaskSnapshot = { taskId: 'task_old', sessionId: 'old-epoch', prompt: 'old ordinary input',
  status: 'completed', materials: [], events: [], createdAt: 1, updatedAt: 2 };

it('checks the actual old preload capability instead of the always-present bridge wrapper', async () => {
  window.xiaokDesktop = { recoverTask: vi.fn(async () => ({ snapshot })) } as unknown as typeof window.xiaokDesktop;
  const value = await recoverForDisplay(api, snapshot.taskId, undefined, () => true);
  expect(value.snapshot).toEqual(snapshot);
  expect(value.presentation).toBeUndefined();
});

it('does not downgrade a present preload method when it denies the new read', async () => {
  const read = vi.fn(async () => { throw new Error('task_history_unavailable'); });
  window.xiaokDesktop = { recoverTask: vi.fn(async () => ({ snapshot })), readTaskHistory: read } as unknown as typeof window.xiaokDesktop;
  await expect(recoverForDisplay(api, snapshot.taskId, undefined, () => true)).rejects.toThrow('task_history_unavailable');
  expect(read).toHaveBeenCalledTimes(1);
});
