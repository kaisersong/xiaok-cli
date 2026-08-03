import { describe, expect, it } from 'vitest';

import { automationFocusTargetId } from '../../renderer/src/lib/automation-deep-link';

describe('automation deep links', () => {
  it('extracts router location hashes for loop and schedule targets', () => {
    expect(automationFocusTargetId('#loop-weekly-review', 'loop')).toBe('loop-weekly-review');
    expect(automationFocusTargetId('#task-price-monitor', 'task')).toBe('task-price-monitor');
  });

  it('rejects unrelated or empty hashes', () => {
    expect(automationFocusTargetId('#task-price-monitor', 'loop')).toBeNull();
    expect(automationFocusTargetId('#loop-', 'loop')).toBeNull();
    expect(automationFocusTargetId('', 'task')).toBeNull();
  });
});
