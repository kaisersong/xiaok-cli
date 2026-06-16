import { describe, expect, it } from 'vitest';

import { parseScheduledTaskPromptDisplay } from '../../renderer/src/lib/scheduled-task-prompt-display';

describe('scheduled task prompt display', () => {
  it('hides scheduled system lines and keeps only the user prompt visible', () => {
    const parsed = parseScheduledTaskPromptDisplay([
      '[SYSTEM: 这是用户设置的自动定时任务，请给出友好简洁的回复。]',
      '[SYSTEM: scheduled_task_id=scheduled-ai-daily; timed_action_id=scheduled-ai-daily; timed_action_title=AI日报]',
      '[SYSTEM: scheduled_due_at=2026-06-16T00:00:00.000Z; claimed_at=2026-06-16T00:00:19.948Z; overdue_ms=19948]',
      '',
      '给我当天的AI日报',
      '',
      '[SYSTEM: 本次自动任务唯一正确的 scheduled_task_id 是 scheduled-ai-daily。]',
    ].join('\n'));

    expect(parsed.displayPrompt).toBe('给我当天的AI日报');
    expect(parsed.notice).toContain('定时任务「AI日报」');
    expect(parsed.notice).toContain('计划执行');
    expect(parsed.notice).toContain('实际执行');
    expect(parsed.notice).not.toContain('scheduled_task_id');
    expect(parsed.notice).not.toContain('timed_action_id');
    expect(parsed.metadata).toMatchObject({
      taskId: 'scheduled-ai-daily',
      timedActionId: 'scheduled-ai-daily',
      title: 'AI日报',
      overdueMs: 19948,
    });
    expect(parsed.metadata?.scheduledDueAt).toBe(Date.parse('2026-06-16T00:00:00.000Z'));
    expect(parsed.metadata?.claimedAt).toBe(Date.parse('2026-06-16T00:00:19.948Z'));
  });

  it('leaves ordinary prompts unchanged and produces no scheduled notice', () => {
    const parsed = parseScheduledTaskPromptDisplay('帮我写一篇报告');

    expect(parsed.displayPrompt).toBe('帮我写一篇报告');
    expect(parsed.notice).toBeUndefined();
    expect(parsed.metadata).toBeUndefined();
  });
});
