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

  it('uses a 30 minute default lease before releasing stale scheduled task claims', async () => {
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

    const scheduler = new TimedActionScheduler(store, {
      executors: {},
      now: () => 10 * 60_000,
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
        return {};
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
      execute: vi.fn(() => ({})),
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
