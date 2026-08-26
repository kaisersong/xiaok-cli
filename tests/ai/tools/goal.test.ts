import { describe, expect, it } from 'vitest';
import { createGoalTools } from '../../../src/ai/tools/goal.js';

describe('Goal tools', () => {
  it('only exposes get plus completion/block claims, never user mutations', () => {
    const tools = createGoalTools({
      getGoal: async () => null,
      requestComplete: async () => ({ accepted: true }),
      requestBlocked: async () => ({ accepted: true }),
    });
    expect(tools.map(tool => tool.definition.name)).toEqual([
      'goal_get', 'goal_request_complete', 'goal_request_blocked',
    ]);
    expect(tools.some(tool => /cancel|pause|resume|replace/u.test(tool.definition.name))).toBe(false);
  });

  it('passes claims to the host without mutating Goal directly', async () => {
    let summary = '';
    const tools = createGoalTools({
      getGoal: async () => ({ goalId: 'goal_1', revision: 1 }),
      requestComplete: async (next) => { summary = next; return { accepted: true }; },
      requestBlocked: async () => ({ accepted: false, reason: 'audit required' }),
    });
    expect(await tools[1]!.execute({ summary: 'done' })).toContain('accepted');
    expect(summary).toBe('done');
    expect(await tools[2]!.execute({ reason: 'x', fingerprint: 'same' })).toContain('audit required');
  });
});
