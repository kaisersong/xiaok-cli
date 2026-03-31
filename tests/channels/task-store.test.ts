import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileTaskStore } from '../../src/channels/task-store.js';

describe('task store', () => {
  it('persists remote tasks and updates across store instances', () => {
    const root = join(tmpdir(), `xiaok-task-store-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'tasks.json');

    try {
      const store = new FileTaskStore(filePath);
      const task = store.create({
        sessionId: 'sess_1',
        prompt: '修复后台通知',
        replyTarget: {
          chatId: 'robot-1',
          userId: 'openid-1',
        },
        cwd: '/repo',
      });
      store.update(task.taskId, {
        status: 'completed',
        replySummary: '已修复',
      });

      const reloaded = new FileTaskStore(filePath);
      expect(reloaded.get(task.taskId)).toMatchObject({
        taskId: task.taskId,
        status: 'completed',
        replySummary: '已修复',
      });
      expect(reloaded.listBySession('sess_1')[0]?.taskId).toBe(task.taskId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks in-flight tasks as interrupted when reloading after restart', () => {
    const root = join(tmpdir(), `xiaok-task-store-restart-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'tasks.json');

    try {
      const store = new FileTaskStore(filePath);
      const task = store.create({
        sessionId: 'sess_1',
        prompt: '继续执行',
        replyTarget: {
          chatId: 'robot-1',
          userId: 'openid-1',
        },
      });
      store.update(task.taskId, {
        status: 'running',
        latestEvent: '任务开始执行',
      });

      const reloaded = new FileTaskStore(filePath);
      expect(reloaded.get(task.taskId)).toMatchObject({
        taskId: task.taskId,
        status: 'failed',
        errorMessage: 'task interrupted by process restart',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
