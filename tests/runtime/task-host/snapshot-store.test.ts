import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

describe('FileTaskSnapshotStore', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-task-host-snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('saves and recovers one active task snapshot', async () => {
    const store = new FileTaskSnapshotStore(rootDir);
    await store.save(createSnapshot('task_1', 'running'));

    expect(await store.getActiveTask()).toEqual({ taskId: 'task_1' });
    expect(await store.recoverTask('task_1')).toMatchObject({
      taskId: 'task_1',
      status: 'running',
      prompt: '生成 A 客户方案 PPT',
    });

    const reloaded = new FileTaskSnapshotStore(rootDir);
    expect(await reloaded.getActiveTask()).toEqual({ taskId: 'task_1' });
    expect(await reloaded.recoverTask('task_1')).toMatchObject({
      taskId: 'task_1',
      status: 'running',
    });
  });

  it('clears active task when a completed snapshot is saved but keeps failed snapshots recoverable', async () => {
    const store = new FileTaskSnapshotStore(rootDir);
    await store.save(createSnapshot('task_1', 'running'));
    await store.save(createSnapshot('task_1', 'completed'));

    expect(await store.getActiveTask()).toBeNull();
    expect(await store.recoverTask('task_1')).toMatchObject({
      taskId: 'task_1',
      status: 'completed',
    });

    await store.save({
      ...createSnapshot('task_2', 'failed'),
      salvage: {
        summary: ['已识别客户诉求'],
        reason: 'missing_material',
      },
    });

    expect(await store.getActiveTask()).toBeNull();
    expect(await store.recoverTask('task_2')).toMatchObject({
      taskId: 'task_2',
      status: 'failed',
      salvage: {
        summary: ['已识别客户诉求'],
        reason: 'missing_material',
      },
    });
  });
});

function createSnapshot(taskId: string, status: TaskSnapshot['status']): TaskSnapshot {
  return {
    taskId,
    sessionId: 'sess_1',
    status,
    prompt: '生成 A 客户方案 PPT',
    materials: [],
    events: [],
    createdAt: 1,
    updatedAt: 2,
  };
}
