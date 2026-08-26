import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/xiaok-goal-ipc-test' },
  BrowserWindow: {
    getAllWindows: () => [],
    fromWebContents: () => undefined,
  },
  clipboard: { read: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

import { registerDesktopIpc } from '../../electron/ipc.js';

describe('desktop Goal IPC', () => {
  it('exposes only semantic Goal operations and forwards main-owned events', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const window = {
      isDestroyed: () => false,
      once: vi.fn(),
      webContents: {
        id: 1,
        send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
      },
    };
    let goalChanged: ((input: unknown) => void) | undefined;
    let taskPrepared: ((input: unknown) => void) | undefined;
    const services = {
      getDataRoot: () => '/tmp/xiaok-goal-ipc-test',
      createTask: vi.fn(async (input: unknown) => input),
      getGoal: vi.fn(async (threadId: string) => ({ threadId })),
      createGoal: vi.fn(async (input: unknown) => input),
      pauseGoal: vi.fn(async (threadId: string) => ({ threadId })),
      resumeGoal: vi.fn(async (input: unknown) => input),
      cancelGoal: vi.fn(async (threadId: string) => ({ threadId })),
      replaceGoal: vi.fn(async (input: unknown) => input),
      ackGoalTaskAttached: vi.fn(async () => undefined),
      setGoalUserQueuePending: vi.fn(async () => undefined),
      subscribeGoalChanged(listener: (input: unknown) => void) { goalChanged = listener; return () => undefined; },
      subscribeGoalTaskPrepared(listener: (input: unknown) => void) { taskPrepared = listener; return () => undefined; },
    };
    await registerDesktopIpc({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    } as never, window as never, services as never);

    await expect(handlers.get('desktop:goal:create')?.({}, {
      threadId: 'thread_1', objective: '完成任务', expectedEvidenceKinds: ['answer'], turnLimit: 4,
      requestSource: 'agent',
    })).rejects.toThrow(/field/i);
    await handlers.get('desktop:goal:create')?.({}, {
      threadId: 'thread_1', objective: '完成任务', expectedEvidenceKinds: ['answer'], turnLimit: 4,
    });
    expect(services.createGoal).toHaveBeenCalledWith({
      threadId: 'thread_1', objective: '完成任务', expectedEvidenceKinds: ['answer'], turnLimit: 4,
    });
    await handlers.get('desktop:createTask')?.({}, {
      prompt: 'hello', materials: [], context: { threadId: 'thread_1' },
      executionScope: { kind: 'goal_turn', goalId: 'forged' }, permissionMode: 'auto',
    });
    expect(services.createTask).toHaveBeenCalledWith({
      prompt: 'hello', materials: [], context: { threadId: 'thread_1' },
    });

    goalChanged?.({ threadId: 'thread_1', goal: { state: { status: 'active' } } });
    taskPrepared?.({ threadId: 'thread_1', attachmentId: 'attachment_1', taskId: 'task_1' });
    expect(sent).toEqual([
      { channel: 'desktop:goal:changed', payload: { threadId: 'thread_1', goal: { state: { status: 'active' } } } },
      { channel: 'desktop:goal:taskPrepared', payload: { threadId: 'thread_1', attachmentId: 'attachment_1', taskId: 'task_1' } },
    ]);
  });
});
