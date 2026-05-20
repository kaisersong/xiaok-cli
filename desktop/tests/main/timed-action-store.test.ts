import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TimedActionStore } from '../../electron/timed-action-store.js';

describe('TimedActionStore', () => {
  let rootDir: string;
  let store: TimedActionStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-timed-action-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new TimedActionStore(join(rootDir, 'timed-actions.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('claims each due action once with a lock and recovery context', () => {
    const action = store.createAction({
      id: 'action_due',
      title: '检查项目',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'agent_task', prompt: '检查项目' },
      source: 'agent',
      now: 500,
    });

    expect(action.nextDueAt).toBe(1_000);

    const claimed = store.claimDueActions(2_500, 10, { recoveryReason: 'startup_recovery' });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].action.id).toBe('action_due');
    expect(claimed[0].context).toMatchObject({
      scheduledDueAt: 1_000,
      claimedAt: 2_500,
      overdueMs: 1_500,
      recoveryReason: 'startup_recovery',
    });

    expect(store.claimDueActions(2_500, 10)).toHaveLength(0);
    expect(store.getAction('action_due')?.lockedRunId).toBe(claimed[0].runId);
  });

  it('does not advance an action that was cancelled while its executor was running', () => {
    store.createAction({
      id: 'action_cancel',
      title: '每 5 分钟检查',
      trigger: { kind: 'interval', intervalMinutes: 5 },
      executor: { kind: 'agent_task', prompt: '检查项目' },
      policy: { maxRuns: 288, expiresAt: 24 * 60 * 60_000, maxConsecutiveFailures: 3 },
      source: 'agent',
      now: 0,
    });

    const [claimed] = store.claimDueActions(5 * 60_000, 1);
    expect(claimed.action.id).toBe('action_cancel');

    expect(store.cancelAction('action_cancel', '项目已完成', 5 * 60_000 + 100)).toBe(true);
    store.finishRunSuccess('action_cancel', claimed.runId, 5 * 60_000 + 200, { runtimeTaskId: 'task_done' });

    const current = store.getAction('action_cancel');
    expect(current?.status).toBe('cancelled');
    expect(current?.nextDueAt).toBeUndefined();
    expect(current?.lastRuntimeTaskId).toBeUndefined();
  });

  it('coalesces an overdue interval action into one successful run and advances from claim time', () => {
    store.createAction({
      id: 'action_interval',
      title: '喝水',
      trigger: { kind: 'interval', intervalMinutes: 5 },
      executor: { kind: 'notify', message: '喝水' },
      source: 'user',
      now: 0,
    });

    const [claimed] = store.claimDueActions(20 * 60_000, 1, { recoveryReason: 'sleep_wake' });
    expect(claimed.context.missedIntervals).toBe(3);

    store.finishRunSuccess('action_interval', claimed.runId, 20 * 60_000, {});

    const current = store.getAction('action_interval');
    expect(current?.runCount).toBe(1);
    expect(current?.lastDueAt).toBe(20 * 60_000);
    expect(current?.nextDueAt).toBe(25 * 60_000);
  });

  it('records skipped recovery decisions without invoking executor side effects', () => {
    store.createAction({
      id: 'action_skip',
      title: '过期一次性任务',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'agent_task', prompt: '检查' },
      source: 'agent',
      now: 0,
    });

    const [claimed] = store.claimDueActions(10_000, 1);
    store.finishRunSkipped('action_skip', claimed.runId, 10_000, {
      action: 'complete',
      reason: 'too old',
    });

    const current = store.getAction('action_skip');
    expect(current?.status).toBe('completed');
    expect(store.listRuns('action_skip')[0]).toMatchObject({
      status: 'complete',
      error: 'too old',
    });
  });
});
