import { describe, expect, it } from 'vitest';
import { resolveDesktopToolLoopBudget, resolveDesktopRunDeadline } from '../../electron/tool-loop-budget.js';
describe('Desktop tool loop budget', () => {
  it('honors either explicit run deadline without an unbounded root masking it', () => {
    expect(resolveDesktopRunDeadline(Infinity, 100, 1000)).toBe(1100);
    expect(resolveDesktopRunDeadline(1050, undefined, 1000)).toBe(1050);
    expect(resolveDesktopRunDeadline(1050, 100, 1000)).toBe(1050);
    expect(resolveDesktopRunDeadline(undefined, undefined, 1000)).toBe(Infinity);
  });
  it('is unbounded by default and existing task override before environment', () => {
    expect(resolveDesktopToolLoopBudget(undefined, {})).toEqual({ limit: undefined, source: 'default' });
    expect(resolveDesktopToolLoopBudget(500, { XIAOK_AGENT_MAX_ITERATIONS: '200' })).toEqual({ limit: 500, source: 'task' });
    expect(resolveDesktopToolLoopBudget(undefined, { XIAOK_AGENT_MAX_ITERATIONS: '200' })).toEqual({ limit: 200, source: 'environment' });
    expect(resolveDesktopToolLoopBudget(undefined, { XIAOK_MULTI_AGENT_MAX_ITERATIONS: '300' }).limit).toBe(300);
  });
  it.each(['0', '-1', '0.5', 'NaN', 'Infinity', '2.5', ' '])('rejects invalid budget %s', raw => {
    expect(resolveDesktopToolLoopBudget(undefined, { XIAOK_AGENT_MAX_ITERATIONS: raw }).limit).toBeUndefined();
  });
});
