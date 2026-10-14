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
import type { GoalNativeQueryDto } from '../../shared/goal-native-query-ipc-contract.js';
import type { DesktopGoalMutationResult, DesktopGoalProjection } from '../../electron/preload-api.js';
import { createGoalState } from '../../../src/runtime/goal/reducer.js';

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
    const event = { sender: { isDestroyed: () => false } };
    // Synthetic public wire data only. These IDs/correlations grant no native task or owner authority.
    const scriptedGoal = (): DesktopGoalProjection => ({ state: createGoalState({ sessionId: 'thread_1', objective: 'Scripted transport fixture', expectedEvidenceKinds: ['answer'], now: 100 }), activation: 'disarmed', currentCompletion: { kind: 'ordinary' } });
    const scriptedMutation = (): NonNullable<GoalNativeQueryDto> => ({ id: 'scripted-summary', kind: 'create', status: 'reserved', objective: 'original' });
    const scriptedTaskReply = (): DesktopGoalMutationResult => {
      const goal = scriptedGoal();
      return { goal, preparedTask: { attachmentId: 'scripted-attachment', attachmentSource: { kind: 'request', requestId: null }, threadId: 'thread_1', taskId: 'scripted-task', executionScope: { kind: 'goal_turn', origin: 'user', goalId: goal.state.goalId, epoch: goal.state.epoch, goalTurnId: 'scripted-turn', threadId: 'thread_1' }, goalRef: { goalId: goal.state.goalId, revision: goal.state.revision }, expiresAt: 1000 } };
    };

    const services = {
      getDataRoot: () => '/tmp/xiaok-goal-ipc-test',
      // Scripted public transport DTOs only: no SDK instances, grant or authority.
      createTask: vi.fn(async (_input: unknown) => ({ taskId: 'scripted-task' })),
      getGoalNativeMutation: vi.fn(async (_threadId: string) => ({ id: 'scripted-summary', kind: 'create', status: 'reserved', objective: 'original' } satisfies GoalNativeQueryDto)),
      recoverGoalNativeMutation: vi.fn(async (_input: unknown) => ({ mutation: scriptedMutation(), goal: scriptedGoal() })),
      continueGoalNativeMutation: vi.fn(async (_input: unknown) => scriptedTaskReply()),
      cancelGoalNativeMutation: vi.fn(async (_input: unknown) => scriptedMutation()),
      getGoal: vi.fn(async (threadId: string) => ({ threadId })),
      createGoal: vi.fn(async (_input: unknown) => scriptedTaskReply()),
      pauseGoal: vi.fn(async (threadId: string) => ({ threadId })),
      resumeGoal: vi.fn(async (_input: unknown) => scriptedTaskReply()),
      recoverGoalPublication: vi.fn(async (_input: unknown) => scriptedGoal()),
      continueGoalPublication: vi.fn(async (_input: unknown) => scriptedGoal()),
      cancelGoal: vi.fn(async (threadId: string) => ({ threadId })),
      replaceGoal: vi.fn(async (_input: unknown) => scriptedTaskReply()),
      ackGoalTaskAttached: vi.fn(async () => undefined),
      setGoalUserQueuePending: vi.fn(async () => undefined),
      subscribeGoalChanged(listener: (input: unknown) => void) { goalChanged = listener; return () => undefined; },
      subscribeGoalTaskPrepared(listener: (input: unknown) => void) { taskPrepared = listener; return () => undefined; },
    };
    await registerDesktopIpc({
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    } as never, window as never, services as never, { multiAgentAuthorize: () => ({ actorId: 'goal-ipc-test' }) });

    await expect(handlers.get('desktop:goal:create')?.(event, {
      threadId: 'thread_1', objective: '完成任务', expectedEvidenceKinds: ['answer'], turnLimit: 4,
      requestSource: 'agent',
    })).rejects.toThrow(/field/i);
    await handlers.get('desktop:goal:create')?.(event, {
      threadId: 'thread_1', objective: '完成任务', expectedEvidenceKinds: ['answer'], turnLimit: 4,
    });
    expect(services.createGoal).toHaveBeenCalledWith({
      threadId: 'thread_1', objective: '完成任务', expectedEvidenceKinds: ['answer'], turnLimit: 4,
    });
    await handlers.get('desktop:createTask')?.(event, {
      prompt: 'hello', materials: [], context: { threadId: 'thread_1' },
      executionScope: { kind: 'goal_turn', goalId: 'forged' }, permissionMode: 'auto',
    });
    expect(services.createTask).toHaveBeenCalledWith({
      prompt: 'hello', materials: [], context: { threadId: 'thread_1' },
    }, { actorId: 'goal-ipc-test', requestSource: 'user' });

    for (const [channel, method] of [['recoverPublication', 'recoverGoalPublication'], ['continuePublication', 'continueGoalPublication']] as const) {
      for (const extra of [{ requestSource: 'agent' }, { intentId: 'forged' }, { challenge: {} }]) {
        await expect(handlers.get(`desktop:goal:${channel}`)?.(event, { threadId: 'thread_1', ...extra })).rejects.toThrow(/field|input/);
      }
      await handlers.get(`desktop:goal:${channel}`)?.(event, { threadId: 'thread_1' });
      expect(services[method]).toHaveBeenCalledWith({ threadId: 'thread_1', requestSource: 'user' });
    }

    const verificationDefinition = { version: 1, obligations: [{ obligationId: 'original', predicateId: 'artifact', predicateVersion: '1', semantics: 'current-subject', recipe: { kind: 'artifact-content', checks: [{ id: 'check', path: 'result.txt', sha256: 'a'.repeat(64), structure: 'utf8' }] } }] };
    await handlers.get('desktop:goal:create')?.(event, { threadId: 'thread_1', objective: 'original', expectedEvidenceKinds: ['file_artifact'], verificationDefinition });
    expect(services.createGoal).toHaveBeenLastCalledWith({ threadId: 'thread_1', objective: 'original', expectedEvidenceKinds: ['file_artifact'], verificationDefinition });
    await expect(handlers.get('desktop:goal:create')?.(event, { threadId: 'thread_1', objective: 'original', expectedEvidenceKinds: ['file_artifact'], verificationDefinition: {} })).rejects.toThrow();
    for (const [channel, method] of [['recoverNativeMutation', 'recoverGoalNativeMutation'], ['continueNativeMutation', 'continueGoalNativeMutation'], ['cancelNativeMutation', 'cancelGoalNativeMutation']] as const) {
      expect(handlers.has(`desktop:goal:${channel}`)).toBe(true);
      for (const extra of [{ requestSource: 'agent' }, { mutationId: 'forged' }, { owner: {} }]) await expect(handlers.get(`desktop:goal:${channel}`)?.(event, { threadId: 'thread_1', ...extra })).rejects.toThrow(/field|input/);
      await handlers.get(`desktop:goal:${channel}`)?.(event, { threadId: 'thread_1' });
      expect(services[method]).toHaveBeenCalledWith({ threadId: 'thread_1', requestSource: 'user' });
    }
    await handlers.get('desktop:goal:getNativeMutation')?.(event, { threadId: 'thread_1' });
    expect(services.getGoalNativeMutation).toHaveBeenCalledWith('thread_1');

    goalChanged?.({ threadId: 'thread_1', goal: { state: { status: 'active' } } });
    taskPrepared?.({ threadId: 'thread_1', attachmentId: 'attachment_1', taskId: 'task_1' });
    expect(sent).toEqual([
      { channel: 'desktop:goal:changed', payload: { threadId: 'thread_1', goal: { state: { status: 'active' } } } },
      { channel: 'desktop:goal:taskPrepared', payload: { threadId: 'thread_1', attachmentId: 'attachment_1', taskId: 'task_1' } },
    ]);
  });
});
