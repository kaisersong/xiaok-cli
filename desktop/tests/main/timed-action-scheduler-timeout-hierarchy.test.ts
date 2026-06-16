import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TimedActionScheduler } from '../../electron/timed-action-scheduler.js';
import { TimedActionStore } from '../../electron/timed-action-store.js';
import type { TimedActionExecutorHandler } from '../../electron/timed-action-types.js';

describe('TimedActionScheduler timeout hierarchy', () => {
  let rootDir: string;
  let store: TimedActionStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-timed-scheduler-timeout-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new TimedActionStore(join(rootDir, 'timed-actions.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  describe('per-kind executor timeout', () => {
    it('uses notify timeout (5min) for notify kind even when default scheduler timeout is large', async () => {
      store.createAction({
        id: 'slow_notify',
        title: 'Slow notify',
        trigger: { kind: 'once', at: 1_000 },
        executor: { kind: 'notify', message: 'hello' },
        source: 'user',
        now: 0,
      });

      const observed: { timeoutMs?: number; signal?: AbortSignal } = {};
      const notifyExecutor: TimedActionExecutorHandler = {
        kind: 'notify',
        execute: async (_action, _ctx, runtimeContext) => {
          observed.signal = runtimeContext?.signal;
          // Watch how long until abort fires
          return new Promise((resolve) => {
            runtimeContext?.signal?.addEventListener('abort', () => resolve({}), { once: true });
          });
        },
      };
      const scheduler = new TimedActionScheduler(store, {
        executors: { notify: notifyExecutor },
        now: () => 2_000,
        executorTimeoutForKind: (kind) => kind === 'notify' ? 30 : 60_000,
      });

      const before = Date.now();
      await scheduler.runOnce('normal_tick');
      await vi.waitFor(() => {
        const runs = store.listRuns('slow_notify');
        expect(runs[0]?.status).toBe('failed');
      }, { timeout: 2000 });
      const elapsed = Date.now() - before;
      expect(elapsed).toBeLessThan(500);
    });

    it('uses long timeout for loop kind (allowing host watchdog to finish first)', async () => {
      store.createAction({
        id: 'long_loop',
        title: 'Long Loop',
        trigger: { kind: 'once', at: 1_000 },
        executor: { kind: 'loop', loopId: 'loop_1' },
        source: 'user',
        now: 0,
      });

      let resolveLoop: (() => void) | null = null;
      const loopExecutor: TimedActionExecutorHandler = {
        kind: 'loop',
        execute: async (_action, _ctx, runtimeContext) => {
          await new Promise<void>((resolve, reject) => {
            resolveLoop = () => resolve();
            runtimeContext?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
          return { decision: { loopRunId: 'r1', loopStatus: 'success' } };
        },
      };
      const scheduler = new TimedActionScheduler(store, {
        executors: { loop: loopExecutor },
        now: () => 2_000,
        executorTimeoutForKind: (kind) => kind === 'loop' ? 60_000 : 50,
        maxLoopConcurrent: 1,
      });

      await scheduler.runOnce('normal_tick');
      // Resolve loop after a short delay; the long timeout should not have fired
      await new Promise(resolve => setTimeout(resolve, 100));
      resolveLoop?.();

      await vi.waitFor(() => {
        const runs = store.listRuns('long_loop');
        expect(runs[0]?.status).toBe('success');
      }, { timeout: 2000 });
    });
  });

  describe('AbortSignal propagation to handler', () => {
    it('passes a non-undefined AbortSignal in runtimeContext to executor.execute', async () => {
      store.createAction({
        id: 'signal_check',
        title: 'Signal Check',
        trigger: { kind: 'once', at: 1_000 },
        executor: { kind: 'notify', message: 'x' },
        source: 'user',
        now: 0,
      });

      let receivedSignal: AbortSignal | undefined;
      const notify: TimedActionExecutorHandler = {
        kind: 'notify',
        execute: async (_action, _ctx, runtimeContext) => {
          receivedSignal = runtimeContext?.signal;
          return {};
        },
      };
      const scheduler = new TimedActionScheduler(store, {
        executors: { notify },
        now: () => 2_000,
      });

      await scheduler.runOnce('normal_tick');
      await vi.waitFor(() => {
        expect(receivedSignal).toBeDefined();
      });
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
      expect(receivedSignal?.aborted).toBe(false);
    });

    it('aborts the AbortSignal passed to handler when executor timeout fires', async () => {
      store.createAction({
        id: 'abort_check',
        title: 'Abort Check',
        trigger: { kind: 'once', at: 1_000 },
        executor: { kind: 'notify', message: 'x' },
        source: 'user',
        now: 0,
      });

      const observed: { aborted: boolean; reason: unknown } = { aborted: false, reason: null };
      const notify: TimedActionExecutorHandler = {
        kind: 'notify',
        execute: async (_action, _ctx, runtimeContext) => {
          await new Promise<void>((resolve) => {
            runtimeContext?.signal?.addEventListener('abort', () => {
              observed.aborted = true;
              observed.reason = runtimeContext?.signal?.reason;
              resolve();
            }, { once: true });
          });
          return {};
        },
      };
      const scheduler = new TimedActionScheduler(store, {
        executors: { notify },
        now: () => 2_000,
        executorTimeoutForKind: () => 30,
      });

      await scheduler.runOnce('normal_tick');
      await vi.waitFor(() => {
        expect(observed.aborted).toBe(true);
      }, { timeout: 2000 });
      expect(observed.reason).toBeInstanceOf(Error);
      expect((observed.reason as Error).message).toBe('executor_timeout');
    });
  });

  describe('staleAfterMs default', () => {
    it('uses 75 minute default lease before releasing stale scheduled task claims', async () => {
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

      // 60 min after claim, lock should still hold (< 75 min default)
      const scheduler = new TimedActionScheduler(store, {
        executors: {},
        now: () => 60 * 60_000,
      });
      await scheduler.runOnce('normal_tick');
      expect(store.getAction('leased_agent')?.lockedRunId).toBe(claimed.runId);

      // 80 min after claim, lock should have been released as stale
      const scheduler2 = new TimedActionScheduler(store, {
        executors: {},
        now: () => 80 * 60_000,
      });
      await scheduler2.runOnce('normal_tick');
      const action = store.getAction('leased_agent');
      // Lock released — either lockedRunId is undefined or it is on a fresh re-claim
      if (action?.lockedRunId) {
        expect(action.lockedRunId).not.toBe(claimed.runId);
      }
    });
  });
});
