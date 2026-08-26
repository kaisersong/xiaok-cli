import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PersistedTaskEvent } from '../../../src/runtime/task-host/task-runtime-host.js';
import type { TaskCreateInput, TaskSnapshot } from '../../../src/runtime/task-host/types.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';

class FakeTaskHost {
  readonly prepared: Array<{ taskId: string; input: TaskCreateInput }> = [];
  readonly started: string[] = [];
  readonly cancelled: Array<{ taskId: string; reason?: string }> = [];
  private sequence = 0;

  constructor(private readonly prefix = 'task') {}

  async prepareTask(input: TaskCreateInput) {
    const taskId = `${this.prefix}_${++this.sequence}`;
    this.prepared.push({ taskId, input });
    return { taskId, understanding: undefined };
  }

  async startTask(taskId: string) { this.started.push(taskId); }
  async cancelTask(taskId: string, reason?: string) { this.cancelled.push({ taskId, reason }); }
}

describe('DesktopGoalCoordinator', () => {
  const roots: string[] = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function setup(existingStore?: SqliteGoalStore) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-desktop-goal-'));
    roots.push(root);
    const store = existingStore ?? new SqliteGoalStore(join(root, 'goals.db'));
    const host = new FakeTaskHost();
    const prepared: unknown[] = [];
    const changed: unknown[] = [];
    let attachmentSequence = 0;
    const coordinator = new DesktopGoalCoordinator({
      store,
      taskHost: host,
      instanceId: 'desktop_1',
      now: () => 100,
      createAttachmentId: () => `attachment_${++attachmentSequence}`,
      publishGoalTaskPrepared: event => prepared.push(event),
      publishGoalChanged: event => changed.push(event),
      attachmentTimeoutMs: 30_000,
    });
    return { store, host, coordinator, prepared, changed };
  }

  it('prepares and binds a Goal task before exact attachment ack starts it', async () => {
    const { coordinator, host, prepared } = setup();
    const created = await coordinator.createGoal({
      threadId: 'thread_1', objective: '回答问题', completionCriterion: '给出答案',
      expectedEvidenceKinds: ['answer'], turnLimit: 3,
    });

    expect(host.started).toEqual([]);
    expect(host.prepared[0]?.input.executionScope).toMatchObject({
      kind: 'goal_turn', origin: 'user', threadId: 'thread_1', goalId: created.goal.state.goalId,
    });
    expect(prepared).toHaveLength(1);
    await expect(coordinator.ackGoalTaskAttached({
      threadId: 'thread_wrong', attachmentId: created.preparedTask.attachmentId,
    })).rejects.toThrow(/attachment/i);

    await coordinator.ackGoalTaskAttached({
      threadId: 'thread_1', attachmentId: created.preparedTask.attachmentId,
    });
    expect(host.started).toEqual([created.preparedTask.taskId]);
  });

  it('settles only on durable terminal, then prepares one continuation without starting it', async () => {
    const { coordinator, host, prepared } = setup();
    const created = await coordinator.createGoal({
      threadId: 'thread_1', objective: '持续调查', expectedEvidenceKinds: ['answer'], turnLimit: 3,
    });
    await coordinator.ackGoalTaskAttached({
      threadId: 'thread_1', attachmentId: created.preparedTask.attachmentId,
    });

    await coordinator.handlePersistedTaskEvent(persistedTerminal(
      created.preparedTask.taskId,
      created.preparedTask.executionScope,
      'completed',
    ));

    expect((await coordinator.getGoal('thread_1'))?.state.turnsUsed).toBe(1);
    expect(host.prepared).toHaveLength(2);
    expect(prepared).toHaveLength(2);
    expect(host.started).toEqual([created.preparedTask.taskId]);
    expect(host.prepared[1]?.input.executionScope).toMatchObject({ origin: 'continuation' });
  });

  it('lets a queued user preempt an already-started continuation without double-running', async () => {
    const { coordinator, host } = setup();
    const created = await coordinator.createGoal({
      threadId: 'thread_1', objective: '持续调查', expectedEvidenceKinds: ['answer'], turnLimit: 4,
    });
    await coordinator.ackGoalTaskAttached({
      threadId: 'thread_1', attachmentId: created.preparedTask.attachmentId,
    });
    await coordinator.handlePersistedTaskEvent(persistedTerminal(
      created.preparedTask.taskId, created.preparedTask.executionScope, 'completed',
    ));
    const continuation = coordinator.getPendingAttachmentForTest('thread_1')!;
    await coordinator.ackGoalTaskAttached({
      threadId: 'thread_1', attachmentId: continuation.attachmentId,
    });

    await coordinator.setUserQueuePending({ threadId: 'thread_1', pending: true });
    expect(host.cancelled).toEqual([
      { taskId: continuation.taskId, reason: 'superseded_by_user' },
    ]);
    await coordinator.handlePersistedTaskEvent(persistedTerminal(
      continuation.taskId, continuation.executionScope, 'cancelled', 'superseded_by_user',
    ));
    expect(coordinator.getPendingAttachmentForTest('thread_1')).toBeNull();

    const admitted = await coordinator.admitUserTask({
      prompt: '先处理我的新信息', materials: [], context: { threadId: 'thread_1' },
    });
    expect(host.started.at(-1)).toBe(admitted.taskId);
    expect(host.prepared.at(-1)?.input.executionScope).toMatchObject({ origin: 'user' });
  });

  it('completes from current-turn answer evidence before the last-turn budget block', async () => {
    const { coordinator } = setup();
    const created = await coordinator.createGoal({
      threadId: 'thread_1', objective: '回答问题', expectedEvidenceKinds: ['answer'], turnLimit: 1,
    });
    await coordinator.ackGoalTaskAttached({
      threadId: 'thread_1', attachmentId: created.preparedTask.attachmentId,
    });
    await coordinator.createGoalToolHost(created.preparedTask.taskId).requestComplete('已完成');
    await coordinator.handlePersistedTaskEvent(persistedTerminal(
      created.preparedTask.taskId, created.preparedTask.executionScope, 'completed', undefined, '答案',
    ));

    expect((await coordinator.getGoal('thread_1'))?.state).toMatchObject({
      status: 'complete', turnsUsed: 1, terminalReason: '已完成',
    });
  });

  it('loads persisted Goal disarmed after restart and requires explicit larger budget resume', async () => {
    const first = setup();
    const created = await first.coordinator.createGoal({
      threadId: 'thread_1', objective: '回答问题', expectedEvidenceKinds: ['answer'], turnLimit: 1,
    });
    await first.coordinator.ackGoalTaskAttached({
      threadId: 'thread_1', attachmentId: created.preparedTask.attachmentId,
    });
    await first.coordinator.handlePersistedTaskEvent(persistedTerminal(
      created.preparedTask.taskId, created.preparedTask.executionScope, 'completed',
    ));

    const restartedHost = new FakeTaskHost('restart_task');
    const restarted = new DesktopGoalCoordinator({
      store: first.store, taskHost: restartedHost, instanceId: 'desktop_2', now: () => 200,
      createAttachmentId: () => 'attachment_restart',
    });
    expect((await restarted.getGoal('thread_1'))?.activation).toBe('disarmed');
    await expect(restarted.resumeGoal({ threadId: 'thread_1' })).rejects.toThrow(/turn limit/i);
    await restarted.resumeGoal({ threadId: 'thread_1', turnLimit: 2 });
    expect(restartedHost.prepared).toHaveLength(1);
  });

  it('charges a preempted continuation as an admitted Goal turn without reserving another continuation', async () => {
    const { coordinator } = setup();
    const created = await coordinator.createGoal({
      threadId: 'thread_1', objective: '持续调查', expectedEvidenceKinds: ['answer'], turnLimit: 4,
    });
    await coordinator.ackGoalTaskAttached({
      threadId: 'thread_1', attachmentId: created.preparedTask.attachmentId,
    });
    await coordinator.handlePersistedTaskEvent(persistedTerminal(
      created.preparedTask.taskId, created.preparedTask.executionScope, 'completed',
    ));
    const continuation = coordinator.getPendingAttachmentForTest('thread_1')!;
    await coordinator.ackGoalTaskAttached({
      threadId: 'thread_1', attachmentId: continuation.attachmentId,
    });
    await coordinator.setUserQueuePending({ threadId: 'thread_1', pending: true });
    await coordinator.handlePersistedTaskEvent(persistedTerminal(
      continuation.taskId, continuation.executionScope, 'cancelled', 'superseded_by_user',
    ));
    expect(await coordinator.getGoal('thread_1')).toMatchObject({
      activation: 'armed',
      state: { status: 'active', turnsUsed: 2, tokensUsed: 10 },
    });
    expect(coordinator.getPendingAttachmentForTest('thread_1')).toBeNull();
  });

  it('pauses and disarms on runtime failure instead of claiming Goal blocked', async () => {
    const { coordinator } = setup();
    const created = await coordinator.createGoal({
      threadId: 'thread_1', objective: '持续调查', expectedEvidenceKinds: ['answer'], turnLimit: 4,
    });
    await coordinator.ackGoalTaskAttached({
      threadId: 'thread_1', attachmentId: created.preparedTask.attachmentId,
    });
    await coordinator.handlePersistedTaskEvent(persistedTerminal(
      created.preparedTask.taskId, created.preparedTask.executionScope, 'failed',
    ));
    expect(await coordinator.getGoal('thread_1')).toMatchObject({
      activation: 'disarmed', state: { status: 'paused', terminalReason: 'runtime_error' },
    });
  });

  it('cancels the running Goal task before a user pause disarms the Goal', async () => {
    const { coordinator, host } = setup();
    const created = await coordinator.createGoal({
      threadId: 'thread_1', objective: '持续调查', expectedEvidenceKinds: ['answer'], turnLimit: 4,
    });
    await coordinator.ackGoalTaskAttached({
      threadId: 'thread_1', attachmentId: created.preparedTask.attachmentId,
    });
    await coordinator.pauseGoal({ threadId: 'thread_1' });
    expect(host.cancelled).toContainEqual({ taskId: created.preparedTask.taskId, reason: 'goal_paused' });
    expect(await coordinator.getGoal('thread_1')).toMatchObject({
      activation: 'disarmed', state: { status: 'paused' },
    });
  });

  it('requires three consecutive admitted blocker claims before blocking', async () => {
    const { coordinator } = setup();
    let prepared = (await coordinator.createGoal({
      threadId: 'thread_1', objective: '持续调查', expectedEvidenceKinds: ['answer'], turnLimit: 5,
    })).preparedTask;
    for (let turn = 1; turn <= 3; turn += 1) {
      await coordinator.ackGoalTaskAttached({ threadId: 'thread_1', attachmentId: prepared.attachmentId });
      await coordinator.createGoalToolHost(prepared.taskId).requestBlocked({
        reason: '等待同一外部输入', fingerprint: 'external-input',
      });
      await coordinator.handlePersistedTaskEvent(persistedTerminal(
        prepared.taskId, prepared.executionScope, 'completed',
      ));
      const goal = await coordinator.getGoal('thread_1');
      expect(goal?.state.consecutiveBlockedTurns).toBe(turn);
      if (turn < 3) {
        expect(goal?.state.status).toBe('active');
        prepared = coordinator.getPendingAttachmentForTest('thread_1')!;
      } else {
        expect(goal).toMatchObject({ activation: 'disarmed', state: { status: 'blocked' } });
      }
    }
  });
});

function persistedTerminal(
  taskId: string,
  executionScope: NonNullable<TaskCreateInput['executionScope']>,
  status: 'completed' | 'failed' | 'cancelled',
  cancelReason?: string,
  answer = '',
): PersistedTaskEvent {
  const events: TaskSnapshot['events'] = [
    ...(answer ? [{ type: 'assistant_delta' as const, delta: answer, eventId: 'answer_1' }] : []),
    ...(cancelReason ? [{ type: 'task_cancelled' as const, taskId, reason: cancelReason }] : []),
    { type: 'task_terminal', status },
  ];
  return {
    taskId,
    eventIndex: events.length - 1,
    event: events.at(-1)!,
    snapshot: {
      taskId, sessionId: `session_${taskId}`, status, prompt: 'prompt', materials: [], events,
      understanding: {
        goal: 'goal', deliverable: 'answer', taskType: 'unknown', audience: 'user', inputs: [],
        missingInfo: [], assumptions: [], riskLevel: 'low', suggestedPlan: [], nextAction: 'answer',
      },
      executionScope,
      usage: { inputTokens: 2, outputTokens: 3, known: true },
      createdAt: 1, updatedAt: 2,
    },
  };
}
