import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TimedActionScheduler } from '../../electron/timed-action-scheduler.js';
import { TimedActionStore } from '../../electron/timed-action-store.js';
import type { TimedActionExecutorHandler } from '../../electron/timed-action-types.js';

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
});
