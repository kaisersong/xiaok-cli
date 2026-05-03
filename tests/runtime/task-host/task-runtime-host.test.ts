import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner } from '../../../src/runtime/task-host/task-runtime-host.js';
import type { DesktopTaskEvent, MaterialRecord } from '../../../src/runtime/task-host/types.js';

describe('InProcessTaskRuntimeHost', () => {
  let rootDir: string;
  let materialRegistry: MaterialRegistry;
  let snapshotStore: FileTaskSnapshotStore;
  let material: MaterialRecord;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `xiaok-task-runtime-host-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    const sourcePath = join(rootDir, 'source.md');
    writeFileSync(sourcePath, '# A 客户需求');
    materialRegistry = new MaterialRegistry({
      workspaceRoot: join(rootDir, 'workspace'),
      maxBytes: 1024 * 1024,
      now: () => 100,
    });
    snapshotStore = new FileTaskSnapshotStore(join(rootDir, 'snapshots'));
    material = await materialRegistry.importMaterial({
      taskId: 'seed_task',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates understanding, starts running immediately, and replays events for late subscribers', async () => {
    const runner = vi.fn<TaskRunner>(async () => undefined);
    const host = createHost(runner);

    const created = await host.createTask({
      prompt: '帮我基于这些材料，生成一版给 A 客户 CIO 汇报的制造业数字化方案 PPT 初稿。',
      materials: [{ materialId: material.materialId }],
    });

    expect(created.taskId).toBe('task_1');
    expect(created.understanding?.taskType).toBe('sales_deck');
    await waitFor(() => runner.mock.calls.length === 1);

    const replayed = await takeEvents(host.subscribeTask('task_1'), 2);
    expect(replayed).toEqual([
      { type: 'task_started', taskId: 'task_1' },
      { type: 'understanding_updated', understanding: created.understanding },
    ]);
    await waitFor(async () => (await host.getActiveTask()) === null);
  });

  it('projects runtime events and persists completion without a confirmation step', async () => {
    const runner = vi.fn<TaskRunner>(async ({ emitRuntimeEvent }) => {
      emitRuntimeEvent({
        type: 'breadcrumb_emitted',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stepId: 'step_1',
        status: 'running',
        message: '正在生成方案大纲',
      });
      emitRuntimeEvent({
        type: 'receipt_emitted',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stepId: 'step_1',
        note: '已生成方案大纲',
      });
    });
    const host = createHost(runner);
    await host.createTask({
      prompt: '帮我基于这些材料，生成一版给 A 客户 CIO 汇报的制造业数字化方案 PPT 初稿。',
      materials: [{ materialId: material.materialId }],
    });

    await waitFor(() => runner.mock.calls.length === 1);
    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed');
    const recovered = await host.recoverTask('task_1');
    expect(recovered.snapshot.status).toBe('completed');
    expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
      { type: 'progress', eventId: 'turn_1:step_1:breadcrumb', message: '正在生成方案大纲', stage: 'running' },
      { type: 'result', result: { summary: '已生成方案大纲', artifacts: [] } },
    ]));
    expect(await host.getActiveTask()).toBeNull();
  });

  it('delivers live projected progress to an active subscriber', async () => {
    let emitProgress: ((message: string) => void) | undefined;
    let finishRunner: (() => void) | undefined;
    const runner: TaskRunner = async ({ emitRuntimeEvent }) => {
      emitProgress = (message) => {
        emitRuntimeEvent({
          type: 'breadcrumb_emitted',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          status: 'running',
          message,
        });
      };
      await new Promise<void>((resolve) => {
        finishRunner = resolve;
      });
    };
    const host = createHost(runner);
    await host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });
    const subscription = host.subscribeTask('task_1')[Symbol.asyncIterator]();
    await subscription.next();
    await subscription.next();

    await waitFor(() => Boolean(emitProgress));
    const liveEventPromise = subscription.next();
    emitProgress?.('正在匹配产品能力');

    await expect(liveEventPromise).resolves.toEqual({
      done: false,
      value: {
        type: 'progress',
        eventId: 'turn_1:step_1:breadcrumb',
        message: '正在匹配产品能力',
        stage: 'running',
      },
    });

    finishRunner?.();
    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed');
    await subscription.return?.();
  });

  it('rejects creating a second active task', async () => {
    const host = createHost(async () => undefined);
    await host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });

    await expect(host.createTask({
      prompt: '生成 B 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    })).rejects.toThrow(/active task/i);
  });

  it('can recover an in-flight auto-started task after restart without a confirmation question', async () => {
    let releaseFirstRunner: (() => void) | undefined;
    const firstHost = createHost(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstRunner = resolve;
      });
    });
    const created = await firstHost.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });
    await waitFor(() => firstHost.isExecutingForTest(created.taskId));
    releaseFirstRunner?.();

    const restartedRegistry = new MaterialRegistry({
      workspaceRoot: join(rootDir, 'workspace'),
      maxBytes: 1024 * 1024,
      now: () => 300,
    });
    const restartedStore = new FileTaskSnapshotStore(join(rootDir, 'snapshots'));
    const runner = vi.fn<TaskRunner>(async ({ materials, emitRuntimeEvent }) => {
      expect(materials.map((item) => item.originalName)).toEqual(['source.md']);
      emitRuntimeEvent({
        type: 'receipt_emitted',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stepId: 'step_1',
        note: '恢复后已继续执行',
      });
    });
    const restartedHost = new InProcessTaskRuntimeHost({
      materialRegistry: restartedRegistry,
      snapshotStore: restartedStore,
      runner,
      now: () => 400,
      createTaskId: () => 'task_2',
      createSessionId: () => 'sess_2',
    });

    const recovered = await restartedHost.recoverTask('task_1');
    expect(recovered.snapshot.status).not.toBe('waiting_user');
    expect(recovered.snapshot.events.some((event) => event.type === 'needs_user')).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects unknown materials, stale answers, and missing task recovery', async () => {
    const host = createHost(async () => undefined);

    await expect(host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: 'missing_material' }],
    })).rejects.toThrow(/unknown material/i);

    await host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });

    await expect(host.answerQuestion({
      taskId: 'task_1',
      answer: { questionId: 'missing_question', type: 'choice', choiceId: 'confirm' },
    })).rejects.toThrow(/question not found/i);

    await expect(host.recoverTask('missing_task')).rejects.toThrow(/task not found/i);
  });

  it('cancels active execution and aborts the runner', async () => {
    let observedAbort = false;
    const runner: TaskRunner = async ({ signal }) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          observedAbort = true;
          resolve();
        }, { once: true });
      });
    };
    const host = createHost(runner);
    await host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });

    await waitFor(() => host.isExecutingForTest('task_1'));
    await host.cancelTask('task_1');

    expect(observedAbort).toBe(true);
    const recovered = await host.recoverTask('task_1');
    expect(recovered.snapshot.status).toBe('cancelled');
    expect(recovered.snapshot.salvage).toEqual({
      summary: ['任务已取消，可基于已识别的任务理解继续。'],
      reason: 'cancelled',
    });
    expect(await host.getActiveTask()).toBeNull();
  });

  it('persists failed snapshots with error event and salvage', async () => {
    const host = createHost(async () => {
      throw new Error('runner unavailable');
    });
    await host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });

    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'failed');
    const recovered = await host.recoverTask('task_1');
    expect(recovered.snapshot.status).toBe('failed');
    expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
      { type: 'error', message: 'runner unavailable' },
    ]));
    expect(recovered.snapshot.salvage).toEqual({
      summary: ['已保留任务理解', '已保留 1 个材料引用'],
      reason: 'runner unavailable',
    });
    expect(await host.getActiveTask()).toBeNull();
  });

  function createHost(runner: TaskRunner): InProcessTaskRuntimeHost {
    return new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner,
      now: () => 200,
      createTaskId: () => 'task_1',
      createSessionId: () => 'sess_1',
    });
  }
});

async function takeEvents(iterable: AsyncIterable<DesktopTaskEvent>, count: number): Promise<DesktopTaskEvent[]> {
  const events: DesktopTaskEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
    if (events.length >= count) {
      break;
    }
  }
  return events;
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const startedAt = Date.now();
  while (!await predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('timed out waiting for predicate');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
