import { describe, expect, it, vi } from 'vitest';
import { createRuntimeHooks } from '../../src/runtime/hooks.js';
import { InMemoryApprovalStore } from '../../src/channels/approval-store.js';
import { TaskManager } from '../../src/channels/task-manager.js';
import { YZJRuntimeNotifier } from '../../src/channels/yzj-runtime-notifier.js';
import { waitFor } from '../support/wait-for.js';

describe('yzj runtime notifier', () => {
  it('emits approval and progress messages for the active task', async () => {
    const sent: string[] = [];
    const hooks = createRuntimeHooks();
    const approvals = new InMemoryApprovalStore();
    let finishTask: (() => void) | undefined;
    const manager = new TaskManager({
      notify: async () => undefined,
      execute: async () => {
        await new Promise<void>((resolve) => {
          finishTask = resolve;
        });
        return {
          ok: true,
          generationMs: 0,
          deliveryMs: 0,
          replyLength: 0,
        };
      },
    });

    const task = await manager.createAndStart(
      {
        sessionKey: {
          channel: 'yzj',
          chatId: 'robot-1',
          userId: 'openid-1',
        },
        message: '开始执行',
        replyTarget: {
          chatId: 'robot-1',
          userId: 'openid-1',
        },
      },
      'sess_1'
    );

    await waitFor(() => {
      expect(manager.getActiveTask('sess_1')?.taskId).toBe(task.taskId);
    });

    const notifier = new YZJRuntimeNotifier(
      {
        send: async (_target, text) => {
          sent.push(text);
        },
      },
      manager,
      approvals,
      0
    );

    notifier.bind('sess_1', hooks);
    const approval = approvals.create({
      sessionId: 'sess_1',
      turnId: 'turn_1',
      taskId: manager.getLatestTask('sess_1')?.taskId,
      toolName: 'bash',
      summary: '执行 bash 命令：git status',
    });

    hooks.emit({
      type: 'turn_started',
      sessionId: 'sess_1',
      turnId: 'turn_1',
    });
    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'bash',
      toolInput: {
        command: 'git status',
      },
    });
    hooks.emit({
      type: 'approval_required',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      approvalId: approval.approvalId,
    });

    await waitFor(() => {
      expect(sent.some((text) => text.includes('任务 task_1 开始执行'))).toBe(true);
      expect(sent.some((text) => text.includes('任务 task_1 需要审批'))).toBe(true);
    });

    finishTask?.();
  });
});
