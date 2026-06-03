import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner } from '../../../src/runtime/task-host/task-runtime-host.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

describe('stale task recovery on startup', () => {
  let rootDir: string;
  let snapshotStore: FileTaskSnapshotStore;
  let materialRegistry: MaterialRegistry;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-stale-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it('recovers stale running tasks and marks them failed', async () => {
    const snapshot: TaskSnapshot = {
      taskId: 'task_stale_1',
      sessionId: 'sess_stale_1',
      status: 'running',
      prompt: '帮我写一篇报告',
      materials: [],
      events: [{ type: 'task_started', taskId: 'task_stale_1' }],
      understanding: {
        goal: '写报告',
        deliverable: '报告',
        taskType: 'unknown',
        audience: '用户',
        inputs: [],
        missingInfo: [],
        assumptions: [],
        riskLevel: 'low',
        suggestedPlan: [],
        nextAction: 'execute',
      },
      createdAt: 1000,
      updatedAt: 2000,
    };
    await snapshotStore.save(snapshot);

    const host = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner: vi.fn<TaskRunner>(async () => undefined),
      now: () => 5000,
      createTaskId: () => 'task_new',
      createSessionId: () => 'sess_new',
    });

    const activeRefs = await snapshotStore.getActiveTasks();
    for (const ref of activeRefs) {
      await host.recoverTask(ref.taskId);
    }

    const recovered = await host.recoverTask('task_stale_1');
    expect(recovered.snapshot.status).toBe('failed');
    expect(recovered.snapshot.salvage?.reason).toBe('stale_running_task_recovered');

    const activeTasks = await snapshotStore.getActiveTasks();
    expect(activeTasks).toEqual([]);
  });

  it('skips tasks that are already in a terminal state', async () => {
    const snapshot: TaskSnapshot = {
      taskId: 'task_done',
      sessionId: 'sess_done',
      status: 'completed',
      prompt: '已完成的任务',
      materials: [],
      events: [{ type: 'task_started', taskId: 'task_done' }],
      result: { summary: '完成了', artifacts: [] },
      createdAt: 1000,
      updatedAt: 2000,
    };
    await snapshotStore.save(snapshot);

    const host = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner: vi.fn<TaskRunner>(async () => undefined),
      now: () => 5000,
      createTaskId: () => 'task_new',
      createSessionId: () => 'sess_new',
    });

    const recovered = await host.recoverTask('task_done');
    expect(recovered.snapshot.status).toBe('completed');
  });
});
