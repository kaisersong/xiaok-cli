import { describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../../src/channels/task-manager.js';
import type { ChannelRequest } from '../../src/channels/webhook.js';
import { waitFor } from '../support/wait-for.js';

function createRequest(message: string): ChannelRequest {
  return {
    sessionKey: {
      channel: 'yzj',
      chatId: 'robot-1',
      userId: 'openid-1',
    },
    message,
    replyTarget: {
      chatId: 'robot-1',
      userId: 'openid-1',
    },
  };
}

describe('TaskManager', () => {
  it('creates a task, sends an ack, and completes in background', async () => {
    const notify = vi.fn(async () => undefined);
    const execute = vi.fn(async () => ({
      ok: true as const,
      generationMs: 12,
      deliveryMs: 3,
      replyLength: 18,
      replyPreview: '任务已经处理完成',
    }));
    const manager = new TaskManager({ execute, notify });

    const task = await manager.createAndStart(createRequest('修复 websocket 重连'), 'sess_1');

    expect(task.taskId).toBe('task_1');
    expect(task.status).toBe('queued');
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: '修复 websocket 重连' }),
      expect.stringContaining('已创建任务 task_1')
    );

    await waitFor(() => {
      expect(manager.getTask(task.taskId)).toMatchObject({
        taskId: 'task_1',
        status: 'completed',
        replyLength: 18,
        replySummary: '任务已经处理完成',
      });
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess_1',
        taskId: 'task_1',
        request: expect.objectContaining({ message: '修复 websocket 重连' }),
      })
    );
  });

  it('returns latest task per session', async () => {
    const manager = new TaskManager({
      notify: async () => undefined,
      execute: async () => ({
        ok: true,
        generationMs: 0,
        deliveryMs: 0,
        replyLength: 0,
      }),
    });

    const first = await manager.createAndStart(createRequest('任务一'), 'sess_1');
    const second = await manager.createAndStart(createRequest('任务二'), 'sess_1');

    expect(manager.getLatestTask('sess_1')?.taskId).toBe(second.taskId);
    expect(manager.listTasks('sess_1').map((task) => task.taskId)).toEqual([second.taskId, first.taskId]);
  });

  it('prefers an active task over a newer recovered failure for default status views', async () => {
    const manager = new TaskManager({
      notify: async () => undefined,
      execute: async () => ({
        ok: true,
        generationMs: 0,
        deliveryMs: 0,
        replyLength: 0,
      }),
    });

    const running = await manager.createAndStart(createRequest('仍在执行'), 'sess_1');
    const recovered = await manager.createAndStart(createRequest('重启前中断'), 'sess_1');

    manager.setTaskEvent(running.taskId, '仍在执行');
    manager.setTaskEvent(recovered.taskId, '重启后标记失败');
    (manager as unknown as { updateTask(taskId: string, patch: Record<string, unknown>): void }).updateTask(running.taskId, { status: 'running' });
    (manager as unknown as { updateTask(taskId: string, patch: Record<string, unknown>): void }).updateTask(recovered.taskId, {
      status: 'failed',
      errorMessage: 'task interrupted by process restart',
      finishedAt: Date.now(),
    });

    expect(manager.getLatestTask('sess_1')?.taskId).toBe(recovered.taskId);
    expect(manager.getPreferredStatusTask('sess_1')?.taskId).toBe(running.taskId);
    expect(manager.listRecoveredInterruptedTasks('sess_1').map((task) => task.taskId)).toEqual([recovered.taskId]);
  });

  it('returns no preferred status task when a session only has recovered interrupted tasks', async () => {
    const manager = new TaskManager({
      notify: async () => undefined,
      execute: async () => ({
        ok: true,
        generationMs: 0,
        deliveryMs: 0,
        replyLength: 0,
      }),
    });

    const recovered = await manager.createAndStart(createRequest('重启前中断'), 'sess_1');
    (manager as unknown as { updateTask(taskId: string, patch: Record<string, unknown>): void }).updateTask(recovered.taskId, {
      status: 'failed',
      errorMessage: 'task interrupted by process restart',
      finishedAt: Date.now(),
    });

    expect(manager.getLatestTask('sess_1')?.taskId).toBe(recovered.taskId);
    expect(manager.getPreferredStatusTask('sess_1')).toBeUndefined();
    expect(manager.listRecoveredInterruptedTasks('sess_1').map((task) => task.taskId)).toEqual([recovered.taskId]);
  });

  it('cancels a running task through AbortController', async () => {
    const execute = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        ok: false as const,
        cancelled: true,
        generationMs: 0,
        deliveryMs: 0,
        replyLength: 0,
        errorMessage: 'agent aborted',
      };
    });
    const manager = new TaskManager({
      notify: async () => undefined,
      execute,
    });

    const task = await manager.createAndStart(createRequest('跑一个长任务'), 'sess_1');

    await waitFor(() => {
      expect(manager.getTask(task.taskId)?.status).toBe('running');
    });

    expect(manager.cancelTask(task.taskId)).toMatchObject({
      ok: true,
      message: `任务 ${task.taskId} 已取消`,
    });

    await waitFor(() => {
      expect(manager.getTask(task.taskId)).toMatchObject({
        taskId: task.taskId,
        status: 'cancelled',
        errorMessage: 'cancelled by user',
      });
    });
  });

  it('tracks approval waiting and resume state on the active task', async () => {
    const manager = new TaskManager({
      notify: async () => undefined,
      execute: async () => ({
        ok: true,
        generationMs: 0,
        deliveryMs: 0,
        replyLength: 0,
      }),
    });

    const task = await manager.createAndStart(createRequest('等审批'), 'sess_1');

    await waitFor(() => {
      expect(manager.getTask(task.taskId)?.status).toBe('completed');
    });

    manager.setTaskEvent(task.taskId, '初始进展');
    manager.markWaitingApproval('sess_1', {
      approvalId: 'approval_1',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      summary: '执行 bash 命令：git status',
      taskId: task.taskId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    manager.resumeFromApproval({
      approvalId: 'approval_1',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      summary: '执行 bash 命令：git status',
      taskId: task.taskId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }, 'approve');

    expect(manager.getTask(task.taskId)?.latestEvent).toContain('已通过');
  });
});
