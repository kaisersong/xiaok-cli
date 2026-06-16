import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TimedActionScheduler } from '../../electron/timed-action-scheduler.js';
import { TimedActionStore } from '../../electron/timed-action-store.js';
import type { TimedActionExecutorHandler } from '../../electron/timed-action-types.js';
import { createLoopExecutor } from '../../electron/loop-executor.js';

describe('TimedActionScheduler', () => {
  let rootDir: string;
  let store: TimedActionStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-timed-action-scheduler-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new TimedActionStore(join(rootDir, 'timed-actions.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('lets executor recovery policy skip overdue work without running side effects', async () => {
    store.createAction({
      id: 'old_agent',
      title: '过期检查',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'agent_task', prompt: '检查' },
      source: 'agent',
      now: 0,
    });

    const execute = vi.fn();
    const agentExecutor: TimedActionExecutorHandler = {
      kind: 'agent_task',
      decideRecovery: () => ({ action: 'complete', reason: 'expired one-shot agent task' }),
      execute,
    };
    const scheduler = new TimedActionScheduler(store, {
      executors: { agent_task: agentExecutor },
      now: () => 60_000,
    });

    await scheduler.runOnce('startup_recovery');

    expect(execute).not.toHaveBeenCalled();
    expect(store.getAction('old_agent')?.status).toBe('completed');
    expect(store.listRuns('old_agent')[0]).toMatchObject({
      status: 'complete',
      error: 'expired one-shot agent task',
    });
  });

  it('does not let a long-running agent task block due notifications', async () => {
    store.createAction({
      id: 'long_agent',
      title: '长任务',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'agent_task', prompt: '长任务' },
      source: 'agent',
      now: 0,
    });
    store.createAction({
      id: 'notify_now',
      title: '提醒',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'notify', message: '提醒' },
      source: 'user',
      now: 0,
    });

    let resolveAgent: (() => void) | null = null;
    const agentExecutor: TimedActionExecutorHandler = {
      kind: 'agent_task',
      execute: () => new Promise((resolve) => {
        resolveAgent = () => resolve({});
      }),
    };
    const notifyExecutor: TimedActionExecutorHandler = {
      kind: 'notify',
      execute: vi.fn().mockResolvedValue({}),
    };

    const scheduler = new TimedActionScheduler(store, {
      executors: { agent_task: agentExecutor, notify: notifyExecutor },
      now: () => 2_000,
      maxAgentConcurrent: 1,
    });

    await scheduler.runOnce('normal_tick');
    await Promise.resolve();

    expect(notifyExecutor.execute).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(store.getAction('notify_now')?.status).toBe('completed');
    });

    resolveAgent?.();
  });

  it('keeps lease intact within the default stale-after window', async () => {
    store.createAction({
      id: 'leased_agent',
      title: '长租约任务',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'agent_task', prompt: '长任务' },
      source: 'agent',
      now: 0,
    });
    const [claimed] = store.claimDueActions(1_000, 1);
    expect(claimed.action.id).toBe('leased_agent');

    // 60 min after claim, default 75 min stale-after has not elapsed.
    const scheduler = new TimedActionScheduler(store, {
      executors: {},
      now: () => 60 * 60_000,
    });
    await scheduler.runOnce('startup_recovery');

    expect(store.getAction('leased_agent')?.lockedRunId).toBe(claimed.runId);
    expect(store.listRuns('leased_agent')[0]).toMatchObject({ status: 'claimed' });
  });

  it('notifies owner when an agent scheduled task creates a runtime task', async () => {
    store.createAction({
      id: 'dream',
      title: 'Dream',
      trigger: { kind: 'daily', hour: 5, minute: 0 },
      executor: { kind: 'agent_task', prompt: '复盘' },
      source: 'user',
      nextDueAt: 1_000,
      now: 0,
    });

    const onRunComplete = vi.fn();
    const scheduler = new TimedActionScheduler(store, {
      executors: {
        agent_task: {
          kind: 'agent_task',
          execute: vi.fn().mockResolvedValue({ runtimeTaskId: 'task_result' }),
        },
      },
      now: () => 2_000,
      onRunComplete,
    });

    await scheduler.runOnce('normal_tick');

    await vi.waitFor(() => {
      expect(onRunComplete).toHaveBeenCalledWith(expect.objectContaining({
        runId: expect.any(String),
        status: 'success',
        runtimeTaskId: 'task_result',
        finishedAt: 2_000,
        action: expect.objectContaining({
          id: 'dream',
          lastRuntimeTaskId: 'task_result',
          lastDueAt: 2_000,
        }),
      }));
    });
  });

  it('claims notify, then loop, then agent task without applying agent concurrency to loop', async () => {
    store.createAction({
      id: 'notify_now',
      title: '提醒',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'notify', message: '提醒' },
      source: 'user',
      now: 0,
    });
    store.createAction({
      id: 'loop_now',
      title: '证据回归',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'loop', loopId: 'artifact-evidence-regression' },
      source: 'agent',
      now: 0,
    });
    store.createAction({
      id: 'agent_now',
      title: '自动任务',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'agent_task', prompt: '执行' },
      source: 'agent',
      now: 0,
    });

    const calls: string[] = [];
    const notifyExecutor: TimedActionExecutorHandler = {
      kind: 'notify',
      execute: vi.fn(() => {
        calls.push('notify');
        return {};
      }),
    };
    const loopExecutor: TimedActionExecutorHandler = {
      kind: 'loop',
      execute: vi.fn(() => {
        calls.push('loop');
        return { decision: { loopRunId: 'run_loop_now', loopStatus: 'success' } };
      }),
    };
    const agentExecutor: TimedActionExecutorHandler = {
      kind: 'agent_task',
      execute: vi.fn(() => {
        calls.push('agent_task');
        return {};
      }),
    };
    const scheduler = new TimedActionScheduler(store, {
      executors: { notify: notifyExecutor, loop: loopExecutor, agent_task: agentExecutor },
      now: () => 2_000,
      maxAgentConcurrent: 0,
    });

    await scheduler.runOnce('normal_tick');
    await vi.waitFor(() => {
      expect(calls).toEqual(['notify', 'loop']);
    });

    await vi.waitFor(() => {
      expect(store.listRuns('notify_now')[0]).toMatchObject({ status: 'success' });
      expect(store.listRuns('loop_now')[0]).toMatchObject({ status: 'success' });
    });
    expect(agentExecutor.execute).not.toHaveBeenCalled();
    expect(store.listRuns('agent_now')).toEqual([]);
  });

  it('skips background loop and agent actions when the global auto-run gate is disabled', async () => {
    store.createAction({
      id: 'notify_due',
      title: '提醒',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'notify', message: '提醒' },
      source: 'user',
      now: 0,
    });
    store.createAction({
      id: 'loop_due',
      title: '循环',
      trigger: { kind: 'interval', intervalMinutes: 10 },
      executor: { kind: 'loop', loopId: 'artifact-evidence-regression' },
      source: 'user',
      nextDueAt: 1_000,
      now: 0,
    });
    store.createAction({
      id: 'agent_due',
      title: '自动任务',
      trigger: { kind: 'interval', intervalMinutes: 10 },
      executor: { kind: 'agent_task', prompt: '执行' },
      source: 'agent',
      nextDueAt: 1_000,
      now: 0,
    });

    const notifyExecutor: TimedActionExecutorHandler = {
      kind: 'notify',
      execute: vi.fn(() => ({})),
    };
    const loopExecutor: TimedActionExecutorHandler = {
      kind: 'loop',
      execute: vi.fn(() => ({ decision: { loopRunId: 'run_loop_due', loopStatus: 'success' } })),
    };
    const agentExecutor: TimedActionExecutorHandler = {
      kind: 'agent_task',
      execute: vi.fn(() => ({})),
    };

    const scheduler = new TimedActionScheduler(store, {
      executors: { notify: notifyExecutor, loop: loopExecutor, agent_task: agentExecutor },
      now: () => 2_000,
      isGlobalBackgroundAutoRunEnabled: () => false,
    });

    await scheduler.runOnce('normal_tick');

    await vi.waitFor(() => {
      expect(notifyExecutor.execute).toHaveBeenCalledTimes(1);
      expect(store.listRuns('notify_due')[0]).toMatchObject({ status: 'success' });
    });
    expect(loopExecutor.execute).not.toHaveBeenCalled();
    expect(agentExecutor.execute).not.toHaveBeenCalled();

    for (const actionId of ['loop_due', 'agent_due']) {
      expect(store.listRuns(actionId)[0]).toMatchObject({
        status: 'skip',
        error: 'skipped_auto_run_disabled',
        decision: expect.objectContaining({
          recoveryDecision: { action: 'skip', reason: 'skipped_auto_run_disabled' },
        }),
      });
      expect(store.getAction(actionId)).toMatchObject({
        status: 'active',
        consecutiveFailures: 0,
        lastError: 'skipped_auto_run_disabled',
      });
      expect(store.getAction(actionId)?.nextDueAt).toBeGreaterThan(2_000);
    }
  });

  it('records a cron loop timed action run as skipped when the loop is already running', async () => {
    store.createAction({
      id: 'loop_cron',
      title: '证据回归',
      trigger: { kind: 'daily', hour: 1, minute: 0 },
      executor: { kind: 'loop', loopId: 'artifact-evidence-regression' },
      source: 'agent',
      nextDueAt: 1_000,
      now: 0,
    });

    const onRunComplete = vi.fn();
    const scheduler = new TimedActionScheduler(store, {
      executors: {
        loop: createLoopExecutor({
          runLoop: vi.fn().mockResolvedValue({ status: 'already_running', activeRunId: 'run_active' }),
        }),
      },
      now: () => 2_000,
      onRunComplete,
    });

    await scheduler.runOnce('normal_tick');

    await vi.waitFor(() => {
      expect(store.listRuns('loop_cron')[0]).toMatchObject({
        status: 'skip',
        error: 'loop already running: run_active',
      });
      expect(onRunComplete).toHaveBeenCalledWith(expect.objectContaining({
        status: 'skipped',
        error: 'loop already running: run_active',
      }));
    });
  });

  it('passes the claimed TimedAction run id into scheduled loop triggers', async () => {
    store.createAction({
      id: 'loop_with_run_context',
      title: '证据回归',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'loop', loopId: 'artifact-evidence-regression' },
      source: 'agent',
      now: 0,
    });

    const runLoop = vi.fn().mockResolvedValue({
      status: 'success',
      run: {
        id: 'loop-run-context',
        loopId: 'artifact-evidence-regression',
        status: 'success',
        trigger: { kind: 'scheduled' },
        evidenceIds: ['evidence-1'],
        startedAt: 2_000,
        finishedAt: 2_000,
        updatedAt: 2_000,
        summary: 'ok',
      },
    });
    const scheduler = new TimedActionScheduler(store, {
      executors: {
        loop: createLoopExecutor({ runLoop }),
      },
      now: () => 2_000,
    });

    await scheduler.runOnce('normal_tick');

    await vi.waitFor(() => {
      expect(store.listRuns('loop_with_run_context')[0]).toMatchObject({ status: 'success' });
    });
    const [timedRun] = store.listRuns('loop_with_run_context');
    expect(runLoop).toHaveBeenCalledWith('artifact-evidence-regression', expect.objectContaining({
      timedActionId: 'loop_with_run_context',
      timedActionRunId: timedRun.runId,
    }));
    expect(timedRun.decision).toEqual(expect.objectContaining({
      loopRunId: 'loop-run-context',
      loopStatus: 'success',
    }));
  });

  it('fails a loop timed action when the loop executor omits loopStatus', async () => {
    store.createAction({
      id: 'loop_missing_status',
      title: '证据回归',
      trigger: { kind: 'daily', hour: 1, minute: 0 },
      executor: { kind: 'loop', loopId: 'artifact-evidence-regression' },
      source: 'agent',
      nextDueAt: 1_000,
      now: 0,
    });

    const scheduler = new TimedActionScheduler(store, {
      executors: {
        loop: {
          kind: 'loop',
          execute: vi.fn().mockResolvedValue({
            decision: { loopRunId: 'run_missing_status' },
          }),
        },
      },
      now: () => 2_000,
    });

    await scheduler.runOnce('normal_tick');

    await vi.waitFor(() => {
      expect(store.listRuns('loop_missing_status')[0]).toMatchObject({
        status: 'failed',
        error: 'loop executor decision missing loopStatus',
      });
      expect(store.getAction('loop_missing_status')).toMatchObject({
        consecutiveFailures: 1,
        lastError: 'loop executor decision missing loopStatus',
      });
    });
  });

  it('pauses a loop timed action when the loop executor reports blocked', async () => {
    store.createAction({
      id: 'loop_blocked',
      title: '证据回归',
      trigger: { kind: 'daily', hour: 1, minute: 0 },
      executor: { kind: 'loop', loopId: 'artifact-evidence-regression' },
      source: 'agent',
      nextDueAt: 1_000,
      now: 0,
    });

    const onRunComplete = vi.fn();
    const scheduler = new TimedActionScheduler(store, {
      executors: {
        loop: {
          kind: 'loop',
          execute: vi.fn().mockResolvedValue({
            decision: {
              loopRunId: 'run_blocked',
              loopStatus: 'blocked',
              nextActionKind: 'ask_user',
              nextActionSummary: 'need credentials',
            },
          }),
        },
      },
      now: () => 2_000,
      onRunComplete,
    });

    await scheduler.runOnce('normal_tick');

    await vi.waitFor(() => {
      expect(store.listRuns('loop_blocked')[0]).toMatchObject({
        status: 'pause',
        error: 'blocked_requires_user_action',
        decision: expect.objectContaining({
          recoveryDecision: { action: 'pause', reason: 'blocked_requires_user_action' },
          loopRunId: 'run_blocked',
          loopStatus: 'blocked',
          nextActionKind: 'ask_user',
          nextActionSummary: 'need credentials',
        }),
      });
      expect(store.getAction('loop_blocked')).toMatchObject({
        status: 'paused',
        consecutiveFailures: 0,
        lastError: 'blocked_requires_user_action',
      });
      expect(onRunComplete).toHaveBeenCalledWith(expect.objectContaining({
        status: 'skipped',
        error: 'blocked_requires_user_action',
      }));
    });
  });

  it('records a cron loop timed action run as failed when the loop run fails', async () => {
    store.createAction({
      id: 'loop_cron_failure',
      title: '证据回归',
      trigger: { kind: 'daily', hour: 1, minute: 0 },
      executor: { kind: 'loop', loopId: 'artifact-evidence-regression' },
      source: 'agent',
      nextDueAt: 1_000,
      now: 0,
    });

    const scheduler = new TimedActionScheduler(store, {
      executors: {
        loop: createLoopExecutor({
          runLoop: vi.fn().mockResolvedValue({
            status: 'failed',
            run: {
              id: 'run_failed',
              loopId: 'artifact-evidence-regression',
              status: 'failed',
              trigger: { kind: 'scheduled' },
              evidenceIds: [],
              startedAt: 1_000,
              finishedAt: 2_000,
              updatedAt: 2_000,
              failureKind: 'executor_failed',
              message: 'scanner failed',
            },
          }),
        }),
      },
      now: () => 2_000,
    });

    await scheduler.runOnce('normal_tick');

    await vi.waitFor(() => {
      expect(store.listRuns('loop_cron_failure')[0]).toMatchObject({
        status: 'failed',
        error: 'loop failed: scanner failed',
      });
      expect(store.getAction('loop_cron_failure')).toMatchObject({
        consecutiveFailures: 1,
        lastError: 'loop failed: scanner failed',
      });
    });
  });

  it('does not let many due loops starve an agent task with available agent capacity', async () => {
    for (let index = 0; index < 3; index += 1) {
      store.createAction({
        id: `loop_${index}`,
        title: `证据回归 ${index}`,
        trigger: { kind: 'once', at: 1_000 },
        executor: { kind: 'loop', loopId: `loop-${index}` },
        source: 'agent',
        now: 0,
      });
    }
    store.createAction({
      id: 'agent_due',
      title: '自动任务',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'agent_task', prompt: '执行' },
      source: 'agent',
      now: 0,
    });

    const loopExecutor: TimedActionExecutorHandler = {
      kind: 'loop',
      execute: vi.fn(() => ({ decision: { loopRunId: 'run_loop_due', loopStatus: 'success' } })),
    };
    const agentExecutor: TimedActionExecutorHandler = {
      kind: 'agent_task',
      execute: vi.fn(() => ({})),
    };
    const scheduler = new TimedActionScheduler(store, {
      executors: { loop: loopExecutor, agent_task: agentExecutor },
      now: () => 2_000,
      maxClaimPerTick: 3,
      maxAgentConcurrent: 1,
    });

    await scheduler.runOnce('normal_tick');

    await vi.waitFor(() => {
      expect(agentExecutor.execute).toHaveBeenCalledTimes(1);
      expect(loopExecutor.execute).toHaveBeenCalledTimes(1);
    });
  });
});
