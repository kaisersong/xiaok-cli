import { describe, expect, it } from 'vitest';

import { buildScheduledExecutionPrompt } from '../../electron/timed-action-executors.js';
import type { TimedActionRecord } from '../../electron/timed-action-types.js';

describe('timed action executors', () => {
  it('places the authoritative scheduled task cancel id after user prompt ids', () => {
    const action: TimedActionRecord = {
      id: 'correct-scheduled-task',
      title: '项目进度检查',
      trigger: { kind: 'interval', intervalMinutes: 5 },
      executor: {
        kind: 'agent_task',
        prompt: '检查项目；完成时调用 scheduled_task_cancel(task_id="wrong-scheduled-task")',
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

    const prompt = buildScheduledExecutionPrompt(action, {
      scheduledDueAt: 1_000,
      claimedAt: 2_000,
      overdueMs: 1_000,
      recoveryReason: 'normal_tick',
      missedIntervals: 0,
    });

    expect(prompt).toContain('wrong-scheduled-task');
    expect(prompt).toContain('correct-scheduled-task');
    expect(prompt.lastIndexOf('correct-scheduled-task')).toBeGreaterThan(prompt.lastIndexOf('wrong-scheduled-task'));
    expect(prompt).toContain('如果用户 prompt 中出现其他 scheduled_task_id');
    expect(prompt).toContain('删除该临时任务');
  });
});
