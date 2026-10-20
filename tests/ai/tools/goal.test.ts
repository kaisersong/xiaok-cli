import { describe, expect, it, vi } from 'vitest';
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

  it('checks the actual value and caller after encoding, before returning private Goal bytes', async () => {
    const context = { taskId: 'actual-receiver' }, order: string[] = [];
    const value = { toJSON() { order.push('encoded'); return { terminalReason: 'PRIVATE_GOAL_CANARY' }; } };
    const guard = vi.fn((actual, caller) => {
      expect(actual).toBe(value); expect(caller).toBe(context); expect(order).toEqual(['encoded']);
      throw new Error('goal_content_unavailable');
    });
    const [get] = createGoalTools({ getGoal: async () => value, assertReadCurrent: guard,
      requestComplete: async () => ({ accepted: false }), requestBlocked: async () => ({ accepted: false }) });
    await expect(get!.execute({}, context)).rejects.toThrow('goal_content_unavailable');
    expect(guard).toHaveBeenCalledOnce();
  });

  it('rejects an asynchronous final policy instead of returning unverified Goal bytes', async () => {
    const [get] = createGoalTools({ getGoal: async () => ({ terminalReason: 'PRIVATE_GOAL_CANARY' }),
      assertReadCurrent: (async () => { throw new Error('private policy error'); }) as unknown as () => void,
      requestComplete: async () => ({ accepted: false }), requestBlocked: async () => ({ accepted: false }) });
    await expect(get!.execute({})).rejects.toThrow('goal_content_unavailable');
  });
});
