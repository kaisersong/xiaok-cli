// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import type { DesktopTaskEvent } from '../../../src/runtime/task-host/types.js';
import { bounded, createPostSealHarness, deferred, type PostSealHarness } from '../fixtures/desktop-post-seal-harness.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

// Only map the source-mode fixed entry to an actual compiled native Worker.
// No protocol, exit, classifier, state or durable ACK is mocked.
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      super(mapped ? nativeWorker.output : filename, options);
      if (mapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => {
  if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 });
});

const threadId = 'post-seal-thread';
const newGoal = { threadId, objective: 'Answer the new request', expectedEvidenceKinds: ['answer' as const], turnLimit: 2 };

describe('W2 actual post-seal Chat → prepared Goal attachment window (main boundary, not renderer E2E)', () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close();
    expect(nativeWorker.exits).toBe(nativeWorker.starts);
  });

  async function setup(attachmentTimeoutMs?: number) {
    const checking = deferred(); const releaseChecking = deferred();
    const newModelEntered = deferred(); const releaseNewModel = deferred();
    const goalPaused = deferred();
    let firstReport = true; let runs = 0;
    const f: PostSealHarness = await createPostSealHarness({
      spawnChild: false, prompt: '生成一份报告和一份演示文稿',
      report: async (report, persist) => {
        const ack = await persist();
        if (firstReport && report.delivery.status === 'checking') {
          firstReport = false; checking.resolve(); await releaseChecking.promise;
        }
        return ack;
      },
      emit: async input => {
        if (++runs === 1) {
          await input.emitRuntimeEvent({ type: 'progress_plan_reported', sessionId: input.sessionId,
            steps: [{ id: 'report', label: 'report', status: 'completed' }, { id: 'slides', label: 'slides', status: 'pending' }] });
          return;
        }
        newModelEntered.resolve(); await releaseNewModel.promise;
        await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId,
          turnId: 'new-answer', intentId: 'new-intent', stepId: 'new-step', note: 'A saved answer for the new Goal.' });
      },
    });
    const goals = new SqliteGoalStore(join(f.root, 'goals.sqlite'));
    const goal = new DesktopGoalCoordinator({
      store: goals, instanceId: 'w2-test-owned-desktop', multiAgent: f.service,
      ...(attachmentTimeoutMs === undefined ? {} : { attachmentTimeoutMs }),
      publishGoalChanged: event => { if (event.goal.state.status === 'paused') goalPaused.resolve(); },
      taskHost: {
        prepareTask: input => f.service.prepareRoot(f.host, threadId, input),
        startTask: taskId => f.host.startTask(taskId),
        cancelTask: (taskId, reason) => f.host.cancelTask(taskId, reason),
      },
    });
    cleanup.push(async () => {
      releaseChecking.resolve(); releaseNewModel.resolve();
      try {
        await bounded(f.host.drain());
        if (await goal.getGoal(threadId)) await goal.cancelGoal({ threadId });
      } finally { goals.close(); await f.close(); }
    });
    const oldTaskId = await f.start();
    await bounded(checking.promise);
    return { f, goal, goals, oldTaskId, releaseChecking, newModelEntered, releaseNewModel, goalPaused };
  }

  it('W2-M1 real durable checking leaves the sealed Chat host active but permits a same-thread Goal preparation', async () => {
    const { f, goal, goals, oldTaskId } = await setup();
    const oldBinding = f.store.getRootBinding(oldTaskId)!;
    expect(oldBinding.delivery).toMatchObject({ status: 'checking', verification: 'pending', hostSettlement: 'pending' });
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)).toMatchObject({
      sourceTaskId: oldTaskId, status: 'completed', executionActive: false, resourcesReleased: true,
    });
    expect((await f.host.recoverTask(oldTaskId)).snapshot.status).toBe('running');
    expect(f.host.inFlightTaskIds()).toContain(oldTaskId);

    const created = await goal.createGoal(newGoal);
    expect(created.preparedTask.taskId).not.toBe(oldTaskId);
    expect(created.preparedTask.executionScope).toMatchObject({ kind: 'goal_turn', threadId, origin: 'user' });
    expect(goals.getTaskBinding(created.preparedTask.taskId)).toMatchObject({ attachedAt: null, threadId });
    expect((await f.host.recoverTask(created.preparedTask.taskId)).snapshot.status).toBe('understanding');
    expect(f.store.getRootBinding(created.preparedTask.taskId)?.groupId).toBe(oldBinding.groupId);
    expect(f.host.inFlightTaskIds()).toEqual([oldTaskId]);
    expect(f.runnerCalls).toBe(1);
  });

  it('W2-M2 late A delivery error/terminal remain task-bound and must not settle or overwrite running Goal B', async () => {
    const { f, goal, goals, oldTaskId, releaseChecking, newModelEntered } = await setup();
    const created = await goal.createGoal(newGoal); const newTaskId = created.preparedTask.taskId;
    await goal.ackGoalTaskAttached({ threadId, attachmentId: created.preparedTask.attachmentId });
    await bounded(newModelEntered.promise);
    const beforeGoal = await goal.getGoal(threadId);
    const events: DesktopTaskEvent[] = [];
    const oldStream = (async () => { for await (const event of f.host.subscribeTask(oldTaskId)) events.push(event); })();
    releaseChecking.resolve(); await bounded(oldStream);
    const oldSnapshot = (await f.host.recoverTask(oldTaskId)).snapshot;
    expect(oldSnapshot).toMatchObject({ status: 'failed', hostDelivery: {
      status: 'failed', verification: 'failed', guardFailure: { code: 'deliverables_incomplete' },
    } });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error' }),
      expect.objectContaining({ type: 'task_terminal', status: 'failed' }),
    ]));
    // The shared fixture intentionally has no Goal callback seam. Exercise the
    // actual production consumer with the actual committed event/snapshot,
    // without claiming to test factory callback registration here.
    const eventIndex = oldSnapshot.events.findIndex(event => event.type === 'task_terminal');
    expect(eventIndex).toBeGreaterThanOrEqual(0);
    await goal.handlePersistedTaskEvent({ taskId: oldTaskId, snapshot: oldSnapshot,
      eventIndex, event: oldSnapshot.events[eventIndex]! });
    expect(goals.getTaskBinding(oldTaskId)).toBeNull();
    expect(await goal.getGoal(threadId)).toEqual(beforeGoal);
    expect((await f.host.recoverTask(newTaskId)).snapshot.status).toBe('running');
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)).toMatchObject({ sourceTaskId: newTaskId, status: 'running' });
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)?.hostDeliveryStatus).not.toBe('failed');
    expect(f.store.getRootBinding(oldTaskId)?.delivery?.status).toBe('failed');
    expect(f.runnerCalls).toBe(2); expect(f.cancellations).toBe(0);
  });

  it('W2-M3 ACK response loss after real commit/start is observable via task recovery, not getGoal or ACK retry', async () => {
    const { f, goal, goals, newModelEntered } = await setup();
    const created = await goal.createGoal(newGoal); const newTaskId = created.preparedTask.taskId;
    const beforeGoal = await goal.getGoal(threadId);
    expect((await f.host.recoverTask(newTaskId)).snapshot.status).toBe('understanding');
    expect(goals.getTaskBinding(newTaskId)?.attachedAt).toBeNull();
    const starts = vi.spyOn(f.host, 'startTask');
    const replyLost = new Error('test-owned IPC reply loss after main operation returned');
    // This models only the transport outcome, after the real operation has
    // completed. It neither manufactures an ACK nor retries/cancels the task.
    await expect((async () => {
      await goal.ackGoalTaskAttached({ threadId, attachmentId: created.preparedTask.attachmentId });
      throw replyLost;
    })()).rejects.toBe(replyLost);
    await bounded(newModelEntered.promise);

    expect(goals.getTaskBinding(newTaskId)?.attachedAt).toEqual(expect.any(Number));
    expect((await f.host.recoverTask(newTaskId)).snapshot).toMatchObject({ taskId: newTaskId, status: 'running',
      executionScope: created.preparedTask.executionScope });
    expect(await goal.getGoal(threadId)).toEqual(beforeGoal);
    await expect(goal.ackGoalTaskAttached({ threadId, attachmentId: created.preparedTask.attachmentId }))
      .rejects.toThrow(/attachment.*missing|missing.*attachment/i);
    expect(starts).toHaveBeenCalledExactlyOnceWith(newTaskId);
    expect(f.cancellations).toBe(0); expect(f.runnerCalls).toBe(2);
  });

  it('W2-M4 a real rejected wrong attachment leaves the same public Goal projection but an unstarted recoverable task', async () => {
    const { f, goal, goals, newModelEntered } = await setup();
    const created = await goal.createGoal(newGoal); const taskId = created.preparedTask.taskId;
    const beforeGoal = await goal.getGoal(threadId);
    await expect(goal.ackGoalTaskAttached({ threadId, attachmentId: `${created.preparedTask.attachmentId}_wrong` }))
      .rejects.toThrow(/attachment/i);
    expect(await goal.getGoal(threadId)).toEqual(beforeGoal);
    expect(goals.getTaskBinding(taskId)?.attachedAt).toBeNull();
    expect((await f.host.recoverTask(taskId)).snapshot.status).toBe('understanding');
    expect(f.host.inFlightTaskIds()).not.toContain(taskId);
    expect(f.cancellations).toBe(0); expect(f.runnerCalls).toBe(1);
    await goal.ackGoalTaskAttached({ threadId, attachmentId: created.preparedTask.attachmentId });
    await bounded(newModelEntered.promise);
    expect((await f.host.recoverTask(taskId)).snapshot.status).toBe('running');
    expect(f.runnerCalls).toBe(2);
  });

  it('W2-M5 an unacknowledged saved preparation is cancelled by the original Goal attachment timeout, not a renderer rollback', async () => {
    const { f, goal, goals, oldTaskId, goalPaused } = await setup(100);
    const starts = vi.spyOn(f.host, 'startTask'); const cancellations = vi.spyOn(f.host, 'cancelTask');
    const acknowledgements = vi.spyOn(goal, 'ackGoalTaskAttached');
    const created = await goal.createGoal(newGoal); const taskId = created.preparedTask.taskId;
    expect(goals.getTaskBinding(taskId)).toMatchObject({ taskId, attachedAt: null });
    expect((await f.host.recoverTask(taskId)).snapshot.status).toBe('understanding');
    expect(starts).not.toHaveBeenCalled(); expect(cancellations).not.toHaveBeenCalled();

    // Real timer, real coordinator cancel path, real host snapshot/service
    // control. No helper/renderer can call ACK or cancellation on its behalf.
    await bounded(goalPaused.promise);
    const snapshot = (await f.host.recoverTask(taskId)).snapshot;
    expect(snapshot.status).toBe('cancelled');
    // Prepared/understanding cancellation uses the host's existing salvage +
    // task_terminal path (not the running-only task_cancelled event). The exact
    // source is independently retained by the real cancel call and Goal state.
    expect(snapshot.events).toContainEqual({ type: 'task_terminal', status: 'cancelled' });
    expect(cancellations).toHaveBeenCalledExactlyOnceWith(taskId, 'thread_attachment_timeout');
    expect(acknowledgements).not.toHaveBeenCalled(); expect(starts).not.toHaveBeenCalled();
    expect(goals.getTaskBinding(taskId)).toMatchObject({ taskId, attachedAt: null });
    expect(await goal.getGoal(threadId)).toMatchObject({ activation: 'disarmed', state: {
      status: 'paused', terminalReason: 'thread_attachment_timeout', turnsUsed: 0,
    } });
    expect((await f.host.recoverTask(oldTaskId)).snapshot.status).toBe('running');
    expect(f.store.getRootBinding(oldTaskId)?.delivery?.status).toBe('checking');
    expect(f.rootSignal?.aborted).toBe(false); expect(f.runnerCalls).toBe(1);
  });
});
