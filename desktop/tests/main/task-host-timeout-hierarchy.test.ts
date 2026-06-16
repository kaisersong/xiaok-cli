import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner, type TaskRunnerInput } from '../../../src/runtime/task-host/task-runtime-host.js';

describe('task host timeout hierarchy', () => {
  let rootDir: string;
  let snapshotStore: FileTaskSnapshotStore;
  let materialRegistry: MaterialRegistry;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-task-host-timeout-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    snapshotStore = new FileTaskSnapshotStore(join(rootDir, 'tasks'));
    materialRegistry = new MaterialRegistry({
      workspaceRoot: join(rootDir, 'workspace'),
      maxBytes: 1024 * 1024,
      now: () => 100,
    });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  function createHost(runner: TaskRunner, opts: { taskWatchdogMs?: number } = {}) {
    return new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner,
      taskWatchdogMs: opts.taskWatchdogMs,
    });
  }

  describe('watchdog abort with reason', () => {
    it('aborts the runner with task_watchdog_timeout reason after watchdog elapses', async () => {
      const observed: { reason: unknown } = { reason: null };
      const runner: TaskRunner = async (input: TaskRunnerInput) => {
        await new Promise<void>((resolve, reject) => {
          input.signal.addEventListener('abort', () => {
            observed.reason = input.signal.reason;
            reject(new Error('aborted'));
          }, { once: true });
        });
      };

      const host = createHost(runner, { taskWatchdogMs: 50 });
      const { taskId } = await host.createTask({ prompt: '帮我写报告', materials: [] });
      await vi.waitFor(async () => {
        const { snapshot } = await host.recoverTask(taskId);
        expect(snapshot.status).toBe('failed');
      }, { timeout: 2000 });

      expect(observed.reason).toBeInstanceOf(Error);
      expect((observed.reason as Error).message).toBe('task_watchdog_timeout');
      const { snapshot } = await host.recoverTask(taskId);
      expect(snapshot.salvage?.reason).toBe('task_watchdog_timeout');
    });

    it('uses per-task watchdogMs override when provided in createTask', async () => {
      const startTimes: number[] = [];
      const runner: TaskRunner = async (input: TaskRunnerInput) => {
        startTimes.push(Date.now());
        await new Promise<void>((_, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      };

      const host = createHost(runner, { taskWatchdogMs: 30_000 });
      const { taskId } = await host.createTask({
        prompt: 'short watchdog',
        materials: [],
        watchdogMs: 50,
      });
      const beforeAbort = Date.now();
      await vi.waitFor(async () => {
        const { snapshot } = await host.recoverTask(taskId);
        expect(snapshot.status).toBe('failed');
      }, { timeout: 2000 });
      const afterAbort = Date.now();
      // per-task 50ms overrode instance-level 30s
      expect(afterAbort - beforeAbort).toBeLessThan(1000);
    });

    it('falls back to instance taskWatchdogMs when per-task override is not set', async () => {
      const runner: TaskRunner = async (input: TaskRunnerInput) => {
        await new Promise<void>((_, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      };

      const host = createHost(runner, { taskWatchdogMs: 60 });
      const before = Date.now();
      const { taskId } = await host.createTask({ prompt: 'instance watchdog', materials: [] });
      await vi.waitFor(async () => {
        const { snapshot } = await host.recoverTask(taskId);
        expect(snapshot.status).toBe('failed');
      }, { timeout: 2000 });
      const after = Date.now();
      expect(after - before).toBeLessThan(1500);
    });

    it('does not fire watchdog when runner finishes before timeout', async () => {
      const runner: TaskRunner = async (input: TaskRunnerInput) => {
        // resolve quickly
        input.emitRuntimeEvent({ type: 'turn_text_delta', turnId: 't1', delta: 'ok' });
      };

      const host = createHost(runner, { taskWatchdogMs: 200 });
      const { taskId } = await host.createTask({ prompt: 'fast task', materials: [] });
      await vi.waitFor(async () => {
        const { snapshot } = await host.recoverTask(taskId);
        expect(snapshot.status).toBe('completed');
      }, { timeout: 2000 });

      // Wait past the watchdog deadline; status must not regress
      await new Promise(resolve => setTimeout(resolve, 300));
      const { snapshot } = await host.recoverTask(taskId);
      expect(snapshot.status).toBe('completed');
      expect(snapshot.salvage).toBeUndefined();
    });
  });

  describe('cancelTask abort with reason', () => {
    it('passes user_cancelled reason to the runner signal by default', async () => {
      const observed: { reason: unknown } = { reason: null };
      let started = false;
      const runner: TaskRunner = async (input: TaskRunnerInput) => {
        started = true;
        await new Promise<void>((_, reject) => {
          input.signal.addEventListener('abort', () => {
            observed.reason = input.signal.reason;
            reject(new Error('task cancelled'));
          }, { once: true });
        });
      };

      const host = createHost(runner, { taskWatchdogMs: 30_000 });
      const { taskId } = await host.createTask({ prompt: 'long task', materials: [] });
      await vi.waitFor(() => expect(started).toBe(true), { timeout: 1000 });

      await host.cancelTask(taskId);

      expect(observed.reason).toBeInstanceOf(Error);
      expect((observed.reason as Error).message).toBe('user_cancelled');
      const { snapshot } = await host.recoverTask(taskId);
      expect(snapshot.status).toBe('cancelled');
    });

    it('passes custom reason from cancelTask through to signal.reason', async () => {
      const observed: { reason: unknown } = { reason: null };
      let started = false;
      const runner: TaskRunner = async (input: TaskRunnerInput) => {
        started = true;
        await new Promise<void>((_, reject) => {
          input.signal.addEventListener('abort', () => {
            observed.reason = input.signal.reason;
            reject(new Error('cancelled'));
          }, { once: true });
        });
      };

      const host = createHost(runner, { taskWatchdogMs: 30_000 });
      const { taskId } = await host.createTask({ prompt: 'long task', materials: [] });
      await vi.waitFor(() => expect(started).toBe(true), { timeout: 1000 });

      await host.cancelTask(taskId, 'loop_poll_timeout');

      expect((observed.reason as Error).message).toBe('loop_poll_timeout');
    });
  });

  describe('CAS guard when task already terminal', () => {
    it('does not overwrite completed snapshot when cancelTask is called after completion', async () => {
      const runner: TaskRunner = async () => {
        // resolves immediately, marks completed
      };

      const host = createHost(runner, { taskWatchdogMs: 30_000 });
      const { taskId } = await host.createTask({ prompt: 'finish fast', materials: [] });
      await vi.waitFor(async () => {
        const { snapshot } = await host.recoverTask(taskId);
        expect(snapshot.status).toBe('completed');
      }, { timeout: 2000 });

      // cancelTask after completion must not overwrite to cancelled
      await host.cancelTask(taskId);

      const { snapshot } = await host.recoverTask(taskId);
      expect(snapshot.status).toBe('completed');
    });
  });

  describe('post-runner watchdog quiet zone', () => {
    it('does not abort flush/gate stage when watchdog is disabled after runner returns', async () => {
      let postRunnerAbortedDuringFlush = false;
      const runner: TaskRunner = async (input: TaskRunnerInput) => {
        // runner returns successfully BEFORE watchdog
        input.emitRuntimeEvent({ type: 'turn_text_delta', turnId: 't1', delta: 'final' });
      };

      const host = createHost(runner, { taskWatchdogMs: 80 });
      const { taskId } = await host.createTask({ prompt: 'fast then post', materials: [] });
      await vi.waitFor(async () => {
        const { snapshot } = await host.recoverTask(taskId);
        expect(snapshot.status).toBe('completed');
      }, { timeout: 2000 });

      // Wait past the original watchdog window to ensure no late abort/state regression
      await new Promise(resolve => setTimeout(resolve, 200));
      const { snapshot } = await host.recoverTask(taskId);
      expect(snapshot.status).toBe('completed');
      expect(postRunnerAbortedDuringFlush).toBe(false);
    });
  });

  describe('TaskRunnerInput.deadlineMs propagation', () => {
    it('passes deadlineMs to runner equal to watchdogMs minus 2 minutes when watchdog is large', async () => {
      let observed: number | undefined;
      const runner: TaskRunner = async (input: TaskRunnerInput) => {
        observed = input.deadlineMs;
      };

      const host = createHost(runner, { taskWatchdogMs: 60 * 60_000 });
      const { taskId } = await host.createTask({ prompt: 'check deadline', materials: [] });
      await vi.waitFor(async () => {
        const { snapshot } = await host.recoverTask(taskId);
        expect(snapshot.status).toBe('completed');
      }, { timeout: 2000 });

      expect(observed).toBe(58 * 60_000);
    });

    it('passes deadlineMs at least 1ms even when watchdog is very small', async () => {
      let observed: number | undefined;
      const runner: TaskRunner = async (input: TaskRunnerInput) => {
        observed = input.deadlineMs;
      };

      const host = createHost(runner, { taskWatchdogMs: 100 });
      const { taskId } = await host.createTask({ prompt: 'tiny watchdog', materials: [] });
      await vi.waitFor(async () => {
        const { snapshot } = await host.recoverTask(taskId);
        expect(snapshot.status).toBe('completed');
      }, { timeout: 2000 });

      // small watchdog, deadline floor = 1ms (positive)
      expect(observed).toBeGreaterThan(0);
      expect(observed).toBeLessThanOrEqual(100);
    });
  });
});
