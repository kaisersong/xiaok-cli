import { describe, expect, it } from 'vitest';

import {
  buildScheduledExecutionPrompt,
  createAgentTaskExecutor,
} from '../../electron/timed-action-executors.js';
import type {
  OverdueRecoveryContext,
  TimedActionRecord,
} from '../../electron/timed-action-types.js';

const baseAction: TimedActionRecord = {
  id: 'correct-scheduled-task',
  title: '项目进度检查',
  trigger: { kind: 'interval', intervalMinutes: 5 },
  executor: {
    kind: 'agent_task',
    prompt: '检查项目',
  },
  policy: {},
  status: 'active',
  source: 'agent',
  nextDueAt: 1_000,
  runCount: 0,
  consecutiveFailures: 0,
  createdAt: 1,
  updatedAt: 1,
};

const baseContext: OverdueRecoveryContext = {
  scheduledDueAt: 1_000,
  claimedAt: 2_000,
  overdueMs: 1_000,
  recoveryReason: 'normal_tick',
  missedIntervals: 0,
};

describe('timed action executors', () => {
  it('places the authoritative scheduled task cancel id after user prompt ids', () => {
    const action: TimedActionRecord = {
      ...baseAction,
      executor: {
        kind: 'agent_task',
        prompt: '检查项目；完成时调用 scheduled_task_cancel(task_id="wrong-scheduled-task")',
      },
    };

    const prompt = buildScheduledExecutionPrompt(action, baseContext);

    expect(prompt).toContain('wrong-scheduled-task');
    expect(prompt).toContain('correct-scheduled-task');
    expect(prompt.lastIndexOf('correct-scheduled-task')).toBeGreaterThan(prompt.lastIndexOf('wrong-scheduled-task'));
    expect(prompt).toContain('如果用户 prompt 中出现其他 scheduled_task_id');
    expect(prompt).toContain('删除该临时任务');
  });

  it('appends a plan-only SYSTEM line when planMode is set', () => {
    const prompt = buildScheduledExecutionPrompt(baseAction, baseContext, { planMode: true });
    expect(prompt).toContain('本次只生成计划');
    expect(prompt).toContain('用户尚未批准');
  });

  it('omits plan-only SYSTEM line when planMode is false', () => {
    const prompt = buildScheduledExecutionPrompt(baseAction, baseContext, { planMode: false });
    expect(prompt).not.toContain('本次只生成计划');
  });

  it('uses plan permissionMode when userApprovedAuto is false', async () => {
    const created: Array<{ permissionMode?: string; prompt: string }> = [];
    const executor = createAgentTaskExecutor({
      createTask: async ({ prompt, permissionMode }) => {
        created.push({ prompt, permissionMode });
        return { taskId: 'task_x' };
      },
    });

    const result = await executor.execute({ ...baseAction, userApprovedAuto: false }, baseContext);
    expect(result.runtimeTaskId).toBe('task_x');
    expect(created).toHaveLength(1);
    expect(created[0].permissionMode).toBe('plan');
    expect(created[0].prompt).toContain('本次只生成计划');
  });

  it('uses default permissionMode when userApprovedAuto is true', async () => {
    const created: Array<{ permissionMode?: string; prompt: string }> = [];
    const executor = createAgentTaskExecutor({
      createTask: async ({ prompt, permissionMode }) => {
        created.push({ prompt, permissionMode });
        return { taskId: 'task_y' };
      },
    });

    await executor.execute({ ...baseAction, userApprovedAuto: true }, baseContext);
    expect(created[0].permissionMode).toBe('default');
    expect(created[0].prompt).not.toContain('本次只生成计划');
  });

  it('honours XIAOK_DESKTOP_AUTO_APPROVE_SCHEDULED env override', async () => {
    const previous = process.env.XIAOK_DESKTOP_AUTO_APPROVE_SCHEDULED;
    process.env.XIAOK_DESKTOP_AUTO_APPROVE_SCHEDULED = '1';
    try {
      const created: Array<{ permissionMode?: string; prompt: string }> = [];
      const executor = createAgentTaskExecutor({
        createTask: async ({ prompt, permissionMode }) => {
          created.push({ prompt, permissionMode });
          return { taskId: 'task_z' };
        },
      });

      await executor.execute({ ...baseAction, userApprovedAuto: false }, baseContext);
      expect(created[0].permissionMode).toBe('default');
    } finally {
      if (previous === undefined) delete process.env.XIAOK_DESKTOP_AUTO_APPROVE_SCHEDULED;
      else process.env.XIAOK_DESKTOP_AUTO_APPROVE_SCHEDULED = previous;
    }
  });
});
