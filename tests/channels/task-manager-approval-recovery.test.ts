import { describe, expect, it } from 'vitest';
import { TaskManager } from '../../src/channels/task-manager.js';

describe('TaskManager approval recovery', () => {
  it('marks a waiting approval task as interrupted when the process cannot resume it', async () => {
    const manager = new TaskManager({
      notify: async () => undefined,
      execute: async () => ({
        ok: true,
        generationMs: 0,
        deliveryMs: 0,
        replyLength: 0,
      }),
    });

    const task = await manager.createAndStart({
      sessionKey: {
        channel: 'yzj',
        chatId: 'robot-1',
        userId: 'openid-1',
      },
      message: '需要审批的任务',
      replyTarget: {
        chatId: 'robot-1',
        userId: 'openid-1',
      },
    }, 'sess_1');

    manager.markApprovalInterrupted({
      approvalId: 'approval_1',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      taskId: task.taskId,
      summary: '执行 bash 命令：git push',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }, '网关重启后审批已失效，请重新发起任务');

    expect(manager.getTask(task.taskId)).toMatchObject({
      taskId: task.taskId,
      status: 'failed',
      latestEvent: '网关重启后审批已失效，请重新发起任务',
      errorMessage: '网关重启后审批已失效，请重新发起任务',
    });
  });
});
