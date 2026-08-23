import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner } from '../../../src/runtime/task-host/task-runtime-host.js';

/**
 * Design v58 §5.5 / R27-02: `desktop:createTask` releases its IPC token as soon
 * as the task id exists, while the background `executeTask()` may keep running
 * for up to the watchdog budget. So the execution needs its own
 * `task_execution` token, and the host must expose stopAccepting /
 * abortAllActive / drain to the shutdown coordinator.
 */
describe('task execution owner tokens (design R27-02)', () => {
  let rootDir: string;
  let materialRegistry: MaterialRegistry;
  let snapshotStore: FileTaskSnapshotStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `task-owner-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    materialRegistry = new MaterialRegistry({
      workspaceRoot: join(rootDir, 'workspace'),
      maxBytes: 1024 * 1024,
      now: () => 100,
    });
    snapshotStore = new FileTaskSnapshotStore(join(rootDir, 'snapshots'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  function gated() {
    const aborted: string[] = [];
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runner: TaskRunner = async (input) => {
      markStarted();
      input.signal?.addEventListener('abort', () => {
        aborted.push(String((input.signal as AbortSignal & { reason?: unknown })?.reason ?? 'aborted'));
      });
      await gate;
      return undefined;
    };
    return { runner, started, finish: () => release(), aborted };
  }

  function createHost(runner: TaskRunner, acquireExecutionToken?: (taskId: string) => { release(): void }) {
    return new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner,
      createTaskId: () => 'task_1',
      createSessionId: () => 'sess_1',
      ...(acquireExecutionToken ? { acquireExecutionToken } : {}),
    });
  }

  it('holds a task_execution token across the whole background execution', async () => {
    const live = new Set<string>();
    const { runner, started, finish } = gated();
    const host = createHost(runner, (taskId) => {
      live.add(taskId);
      return { release: () => live.delete(taskId) };
    });

    const created = await host.createTask({ prompt: 'hello', materials: [] });
    await started;

    // createTask has returned: the IPC token is gone, ours is still held.
    expect(live.has(created.taskId)).toBe(true);
    expect(host.activeExecutionCount()).toBe(1);

    finish();
    await host.drain();

    expect(live.has(created.taskId)).toBe(false);
    expect(host.activeExecutionCount()).toBe(0);
  });

  it('rejects a concurrent duplicate deterministically', async () => {
    const { runner, started, finish } = gated();
    const host = createHost(runner);
    const created = await host.createTask({ prompt: 'hello', materials: [] });
    await started;

    await expect(host.startTask(created.taskId)).rejects.toThrow(/already started/);

    finish();
    await host.drain();
  });

  it('stopAccepting refuses new executions with shutting_down', async () => {
    const { runner, finish } = gated();
    const host = createHost(runner);

    host.stopAccepting('app_shutdown');

    await expect(host.createTask({ prompt: 'late', materials: [] })).rejects.toThrow(/shutting_down/);
    finish();
  });

  it('abortAllActive propagates the shutdown reason to the runner signal', async () => {
    const { runner, started, finish, aborted } = gated();
    const host = createHost(runner);
    await host.createTask({ prompt: 'hello', materials: [] });
    await started;

    host.abortAllActive('app_shutdown');
    finish();
    await host.drain();

    expect(aborted.join(',')).toContain('app_shutdown');
  });

  it('drain resolves only after the execution promise settles', async () => {
    const { runner, started, finish } = gated();
    const host = createHost(runner);
    await host.createTask({ prompt: 'hello', materials: [] });
    await started;

    let drained = false;
    const draining = host.drain().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);

    finish();
    await draining;

    expect(drained).toBe(true);
  });
});
