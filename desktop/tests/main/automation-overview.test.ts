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
      schedules: 2,
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
      title: 'Failed Agent Task',
      status: 'failed',
      message: 'agent crashed',
      occurredAt: 5_100,
    });
    expect(snapshot.recentFailures[1]).toMatchObject({
      source: 'loop_run',
      ownerId: 'briefing-loop',
      title: 'Briefing Loop',
      status: 'failed',
      message: 'Output file was not created.',
      occurredAt: 3_100,
    });
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
