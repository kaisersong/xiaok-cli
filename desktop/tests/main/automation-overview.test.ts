import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAutomationOverviewSnapshot, buildAutomationRunHistory } from '../../electron/automation-overview.js';
import { LoopStore } from '../../electron/loop-store.js';
import { TimedActionStore } from '../../electron/timed-action-store.js';

describe('automation overview snapshot', () => {
  let rootDir: string;
  let loopStore: LoopStore;
  let timedActionStore: TimedActionStore;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'xiaok-automation-overview-'));
    loopStore = new LoopStore(join(rootDir, 'loops.sqlite'));
    timedActionStore = new TimedActionStore(join(rootDir, 'timed-actions.sqlite'));
  });

  afterEach(() => {
    loopStore.close();
    timedActionStore.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('derives counts and recent failures from LoopRun and TimedAction facts without treating executed triggers as success', () => {
    const outputDirectory = join(rootDir, 'outputs');
    loopStore.createUserLoopTemplate({
      loopId: 'briefing-loop',
      title: 'Briefing Loop',
      description: 'Write a project briefing.',
      kind: 'markdown_file',
      prompt: 'Write briefing',
      outputDirectory,
      outputFileName: 'briefing.md',
      now: 1_000,
    });

    const success = loopStore.beginLoopRun('briefing-loop', { kind: 'manual' }, 2_000, 60_000);
    expect(success.status).toBe('started');
    if (success.status === 'started') {
      loopStore.finishLoopRunSuccess(success.run.id, ['evidence-success'], 2_100, 'ok');
    }

    const failed = loopStore.beginLoopRun('briefing-loop', { kind: 'manual' }, 3_000, 60_000);
    expect(failed.status).toBe('started');
    if (failed.status === 'started') {
      loopStore.finishLoopRunFailure(failed.run.id, 'evidence_missing', 'Output file was not created.', [], 3_100);
    }

    const action = timedActionStore.createAction({
      id: 'scheduled-briefing',
      title: 'Scheduled Briefing',
      trigger: { kind: 'once', at: 4_000 },
      executor: { kind: 'loop', loopId: 'briefing-loop' },
      source: 'user',
      now: 1_500,
      nextDueAt: 4_000,
    });
    const [claimed] = timedActionStore.claimDueActions(4_000, 1);
    expect(claimed.action.id).toBe(action.id);
    timedActionStore.finishRunSuccess(action.id, claimed.runId, 4_100, {
      decision: { loopRunId: 'not-terminal-yet' },
    });

    const failedAction = timedActionStore.createAction({
      id: 'failed-agent',
      title: 'Failed Agent Task',
      trigger: { kind: 'once', at: 5_000 },
      executor: { kind: 'agent_task', prompt: 'Do work' },
      source: 'agent',
      now: 1_600,
      nextDueAt: 5_000,
    });
    const [failedClaim] = timedActionStore.claimDueActions(5_000, 1);
    expect(failedClaim.action.id).toBe(failedAction.id);
    timedActionStore.finishRunFailure(failedAction.id, failedClaim.runId, 5_100, 'agent crashed');

    const snapshot = buildAutomationOverviewSnapshot({
      loopStore,
      timedActionStore,
      globalBackgroundAutoRunEnabled: false,
      now: 6_000,
    });

    expect(snapshot.generatedAt).toBe(6_000);
    expect(snapshot.sourceVersions).toEqual({
      loopStore: loopStore.getAutomationStoreVersion(),
      timedActionStore: timedActionStore.getAutomationStoreVersion(),
    });
    expect(snapshot.globalBackgroundAutoRunEnabled).toBe(false);
    expect(snapshot.totals).toMatchObject({
      loops: 1,
      userLoops: 1,
      // Once-trigger 'scheduled-briefing' transitions to 'completed' after a
      // successful run; 'failed-agent' stays 'active' because no
      // maxConsecutiveFailures policy. Overview counts now match the Schedules
      // tab which shows only active + paused.
      schedules: 1,
      activeSchedules: 1,
      recentFailures: 2,
    });
    expect(snapshot.recentFailures.map(item => item.id)).toEqual([
      `timed-action:${failedClaim.runId}`,
      `loop-run:${failed.status === 'started' ? failed.run.id : ''}`,
    ]);
    expect(snapshot.recentFailures[0]).toMatchObject({
      source: 'timed_action_run',
      ownerId: 'failed-agent',
      actionAvailableInSchedules: true,
      title: 'Failed Agent Task',
      status: 'failed',
      message: 'agent crashed',
      occurredAt: 5_100,
    });
    expect(snapshot.recentFailures[1]).toMatchObject({
      source: 'loop_run',
      ownerId: 'briefing-loop',
      loopOrigin: 'user_template',
      title: 'Briefing Loop',
      status: 'failed',
      message: 'Output file was not created.',
      occurredAt: 3_100,
    });
  });

  it('fuses a linked failed TimedActionRun and LoopRun into one recent failure', () => {
    const outputDirectory = join(rootDir, 'outputs');
    loopStore.createUserLoopTemplate({
      loopId: 'linked-loop',
      title: 'Linked Loop',
      description: 'Run from a schedule.',
      kind: 'markdown_file',
      prompt: 'Write output',
      outputDirectory,
      outputFileName: 'linked.md',
      now: 1_000,
    });
    const action = timedActionStore.createAction({
      id: 'linked-schedule',
      title: 'Linked Schedule',
      trigger: { kind: 'once', at: 4_000 },
      executor: { kind: 'loop', loopId: 'linked-loop' },
      source: 'user',
      now: 1_500,
      nextDueAt: 4_000,
    });
    const [claimed] = timedActionStore.claimDueActions(4_000, 1);
    const loopRun = loopStore.beginLoopRun('linked-loop', {
      kind: 'scheduled',
      timedActionId: action.id,
      timedActionRunId: claimed.runId,
    }, 4_050, 60_000);
    expect(loopRun.status).toBe('started');
    if (loopRun.status !== 'started') throw new Error('expected loop run to start');
    loopStore.finishLoopRunFailure(loopRun.run.id, 'evidence_missing', 'Loop output missing.', [], 4_100);
    timedActionStore.finishRunFailure(action.id, claimed.runId, 4_120, `loop failed: ${loopRun.run.id}`);

    const snapshot = buildAutomationOverviewSnapshot({
      loopStore,
      timedActionStore,
      globalBackgroundAutoRunEnabled: true,
      now: 5_000,
    });

    expect(snapshot.totals.recentFailures).toBe(1);
    expect(snapshot.recentFailures).toEqual([
      expect.objectContaining({
        id: `timed-action:${claimed.runId}`,
        source: 'timed_action_run',
        actionId: action.id,
        loopId: 'linked-loop',
      }),
    ]);
  });

  it('clears a linked loop failure when the owning schedule has a newer benign result', () => {
    loopStore.createUserLoopTemplate({
      loopId: 'linked-recovery-loop',
      title: 'Linked Recovery Loop',
      description: 'Recover through a later schedule decision.',
      kind: 'markdown_file',
      prompt: 'Write output',
      outputDirectory: join(rootDir, 'outputs'),
      outputFileName: 'linked-recovery.md',
      now: 1_000,
    });
    const action = timedActionStore.createAction({
      id: 'linked-recovery-schedule',
      title: 'Linked Recovery Schedule',
      trigger: { kind: 'interval', intervalMinutes: 1 },
      executor: { kind: 'loop', loopId: 'linked-recovery-loop' },
      source: 'user',
      now: 1_500,
      nextDueAt: 2_000,
    });
    const [failedClaim] = timedActionStore.claimDueActions(2_000, 1);
    const loopRun = loopStore.beginLoopRun('linked-recovery-loop', {
      kind: 'scheduled',
      timedActionId: action.id,
      timedActionRunId: failedClaim.runId,
    }, 2_050, 60_000);
    if (loopRun.status !== 'started') throw new Error('expected linked loop run to start');
    loopStore.finishLoopRunFailure(loopRun.run.id, 'executor_failed', 'temporary provider outage', [], 2_100);
    timedActionStore.finishRunFailure(action.id, failedClaim.runId, 2_120, `loop failed: ${loopRun.run.id}`);

    const dueAt = timedActionStore.getAction(action.id)?.nextDueAt;
    if (!dueAt) throw new Error('expected retry due time');
    const [benignClaim] = timedActionStore.claimDueActions(dueAt, 1);
    timedActionStore.finishRunSkipped(action.id, benignClaim.runId, dueAt + 100, {
      action: 'skip',
      reason: 'logical_run_already_completed: recovered-run',
    });

    const snapshot = buildAutomationOverviewSnapshot({
      loopStore,
      timedActionStore,
      globalBackgroundAutoRunEnabled: true,
      now: dueAt + 200,
    });

    expect(snapshot.recentFailures).toEqual([]);
  });

  it('removes recovered failures from attention while retaining complete run history', () => {
    loopStore.createUserLoopTemplate({
      loopId: 'recovered-loop',
      title: 'Recovered Loop',
      description: 'Recover after one failure.',
      kind: 'markdown_file',
      prompt: 'Write output',
      outputDirectory: join(rootDir, 'outputs'),
      outputFileName: 'recovered.md',
      now: 1_000,
    });
    const failed = loopStore.beginLoopRun('recovered-loop', { kind: 'manual' }, 2_000, 60_000);
    if (failed.status !== 'started') throw new Error('expected failed run to start');
    loopStore.finishLoopRunFailure(failed.run.id, 'executor_failed', 'temporary outage', [], 2_100);
    const success = loopStore.beginLoopRun('recovered-loop', { kind: 'manual' }, 3_000, 60_000);
    if (success.status !== 'started') throw new Error('expected success run to start');
    loopStore.finishLoopRunSuccess(success.run.id, ['evidence-1'], 3_100, 'recovered');

    const snapshot = buildAutomationOverviewSnapshot({
      loopStore,
      timedActionStore,
      globalBackgroundAutoRunEnabled: true,
      now: 4_000,
    });
    const history = buildAutomationRunHistory({ loopStore, timedActionStore, limit: 10 });

    expect(snapshot.recentFailures).toEqual([]);
    expect(history.map(item => item.status)).toEqual(['success', 'failed']);
  });

  it('uses the latest decisive schedule result for running, attention skip, and benign skip', () => {
    const createIntervalAction = (id: string) => timedActionStore.createAction({
      id,
      title: id,
      trigger: { kind: 'interval', intervalMinutes: 1 },
      executor: { kind: 'loop', loopId: `${id}-loop` },
      source: 'user',
      now: 1_000,
      nextDueAt: 2_000,
    });
    const failThen = (
      id: string,
      finish: (actionId: string, runId: string, at: number) => void,
    ) => {
      const action = createIntervalAction(id);
      const [failed] = timedActionStore.claimDueActions(2_000, 1, { executorKinds: ['loop'] });
      timedActionStore.finishRunFailure(action.id, failed.runId, 2_100, `${id}-failed`);
      const dueAt = timedActionStore.getAction(action.id)?.nextDueAt;
      if (!dueAt) throw new Error('expected next due time');
      const [next] = timedActionStore.claimDueActions(dueAt, 1, { executorKinds: ['loop'] });
      finish(action.id, next.runId, dueAt + 100);
      return { action, failed, next };
    };

    const running = failThen('running-owner', (actionId, runId, at) => {
      timedActionStore.markRunRunning(actionId, runId, at);
    });
    const attention = failThen('attention-owner', (actionId, runId, at) => {
      timedActionStore.finishRunSkipped(actionId, runId, at, { action: 'skip', reason: 'loop missing_loop' });
    });
    failThen('benign-owner', (actionId, runId, at) => {
      timedActionStore.finishRunSkipped(actionId, runId, at, { action: 'skip', reason: 'logical_run_already_completed: run-ok' });
    });

    const snapshot = buildAutomationOverviewSnapshot({
      loopStore,
      timedActionStore,
      globalBackgroundAutoRunEnabled: true,
      now: 10_000,
    });

    expect(snapshot.recentFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `timed-action:${running.failed.runId}`, message: 'running-owner-failed' }),
      expect.objectContaining({ id: `timed-action:${attention.next.runId}`, message: 'loop missing_loop' }),
    ]));
    expect(snapshot.recentFailures).toHaveLength(2);
  });

  it.each([
    'assistant_evening_overdue_cutoff',
    'assistant_morning_overdue_cutoff',
  ])('treats the production overdue reason %s as a benign decisive result', reason => {
    const action = timedActionStore.createAction({
      id: `overdue-${reason}`,
      title: reason,
      trigger: { kind: 'interval', intervalMinutes: 1 },
      executor: { kind: 'loop', loopId: `loop-${reason}` },
      source: 'user',
      now: 1_000,
      nextDueAt: 2_000,
    });
    const [failed] = timedActionStore.claimDueActions(2_000, 1, { executorKinds: ['loop'] });
    timedActionStore.finishRunFailure(action.id, failed.runId, 2_100, 'old failure');
    const dueAt = timedActionStore.getAction(action.id)?.nextDueAt;
    if (!dueAt) throw new Error('expected next due time');
    const [skipped] = timedActionStore.claimDueActions(dueAt, 1, { executorKinds: ['loop'] });
    timedActionStore.finishRunSkipped(action.id, skipped.runId, dueAt + 100, { action: 'skip', reason });

    const snapshot = buildAutomationOverviewSnapshot({
      loopStore,
      timedActionStore,
      globalBackgroundAutoRunEnabled: true,
      now: dueAt + 200,
    });

    expect(snapshot.recentFailures).toEqual([]);
  });

  it('marks inactive schedules as unavailable for schedule-list deep links', () => {
    const action = timedActionStore.createAction({
      id: 'cancelled-schedule',
      title: 'Cancelled Schedule',
      trigger: { kind: 'once', at: 4_000 },
      executor: { kind: 'agent_task', prompt: 'Run once' },
      source: 'user',
      now: 1_000,
      nextDueAt: 4_000,
    });
    const [claimed] = timedActionStore.claimDueActions(4_000, 1);
    timedActionStore.finishRunFailure(action.id, claimed.runId, 4_100, 'failed before cancellation');
    expect(timedActionStore.cancelAction(action.id, 'user cancelled', 4_200)).toBe(true);

    const snapshot = buildAutomationOverviewSnapshot({
      loopStore,
      timedActionStore,
      globalBackgroundAutoRunEnabled: true,
      now: 5_000,
    });

    expect(snapshot.recentFailures).toEqual([
      expect.objectContaining({
        source: 'timed_action_run',
        actionId: action.id,
        actionAvailableInSchedules: false,
      }),
    ]);
  });

  it('returns fused run history rows for linked TimedActionRun and LoopRun facts without duplicates', () => {
    const outputDirectory = join(rootDir, 'outputs');
    loopStore.createUserLoopTemplate({
      loopId: 'briefing-loop',
      title: 'Briefing Loop',
      description: 'Write a project briefing.',
      kind: 'markdown_file',
      prompt: 'Write briefing',
      outputDirectory,
      outputFileName: 'briefing.md',
      now: 1_000,
    });

    const action = timedActionStore.createAction({
      id: 'scheduled-briefing',
      title: 'Scheduled Briefing',
      trigger: { kind: 'once', at: 4_000 },
      executor: { kind: 'loop', loopId: 'briefing-loop' },
      source: 'user',
      now: 1_500,
      nextDueAt: 4_000,
    });
    const [claimed] = timedActionStore.claimDueActions(4_000, 1);
    expect(claimed.action.id).toBe(action.id);

    const loopRun = loopStore.beginLoopRun('briefing-loop', {
      kind: 'scheduled',
      timedActionId: action.id,
      timedActionRunId: claimed.runId,
      scheduledDueAt: 4_000,
    }, 4_050, 60_000);
    expect(loopRun.status).toBe('started');
    if (loopRun.status !== 'started') throw new Error('expected loop run to start');
    loopStore.finishLoopRunSuccess(loopRun.run.id, ['file-evidence'], 4_100, 'briefing written');
    timedActionStore.finishRunSuccess(action.id, claimed.runId, 4_120, {
      decision: {
        loopRunId: loopRun.run.id,
        loopStatus: 'success',
      },
    });

    const failedAction = timedActionStore.createAction({
      id: 'failed-agent',
      title: 'Failed Agent Task',
      trigger: { kind: 'once', at: 5_000 },
      executor: { kind: 'agent_task', prompt: 'Do work' },
      source: 'agent',
      now: 1_600,
      nextDueAt: 5_000,
    });
    const [failedClaim] = timedActionStore.claimDueActions(5_000, 1);
    timedActionStore.finishRunFailure(failedAction.id, failedClaim.runId, 5_100, 'agent crashed');

    const history = buildAutomationRunHistory({
      loopStore,
      timedActionStore,
      limit: 10,
    });

    expect(history.map(item => item.id)).toEqual([
      `schedule-run:${failedClaim.runId}`,
      `schedule-run:${claimed.runId}`,
    ]);
    expect(history[1]).toMatchObject({
      automationKind: 'loop',
      scheduleRunId: claimed.runId,
      loopRunId: loopRun.run.id,
      actionId: action.id,
      loopId: 'briefing-loop',
      title: 'Scheduled Briefing',
      startedAt: 4_000,
      finishedAt: 4_120,
      status: 'success',
      schedulerStatus: 'success',
      loopStatus: 'success',
      message: 'briefing written',
      outputPreviewAvailable: true,
    });
    expect(history[0]).toMatchObject({
      automationKind: 'agent_task',
      scheduleRunId: failedClaim.runId,
      actionId: 'failed-agent',
      title: 'Failed Agent Task',
      status: 'failed',
      schedulerStatus: 'failed',
      message: 'agent crashed',
    });
  });
});
