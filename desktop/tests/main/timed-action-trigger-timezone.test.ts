import { describe, expect, it } from 'vitest';
import { computeNextDueAt } from '../../electron/timed-action-trigger.js';

describe('timezone-aware daily timed action triggers', () => {
  it('uses the trigger IANA timezone instead of the machine timezone', () => {
    const dueAt = computeNextDueAt(
      { kind: 'daily', hour: 22, minute: 30, timeZone: 'Asia/Shanghai', daysOfWeek: [1, 2, 3, 4, 5] },
      Date.UTC(2026, 7, 14, 13, 0),
    );

    expect(new Date(dueAt).toISOString()).toBe('2026-08-14T14:30:00.000Z');
  });

  it('skips non-working local dates from the explicit workday set', () => {
    const dueAt = computeNextDueAt(
      { kind: 'daily', hour: 8, minute: 30, timeZone: 'Asia/Shanghai', daysOfWeek: [1, 2, 3, 4, 5] },
      Date.UTC(2026, 7, 14, 23, 0),
    );

    expect(new Date(dueAt).toISOString()).toBe('2026-08-17T00:30:00.000Z');
  });

  it('runs once at the first valid instant after spring-forward and the first repeated fall-back wall time', () => {
    const springForward = computeNextDueAt(
      { kind: 'daily', hour: 2, minute: 30, timeZone: 'America/New_York' },
      Date.UTC(2026, 2, 8, 0, 0),
    );
    const fallBack = computeNextDueAt(
      { kind: 'daily', hour: 1, minute: 30, timeZone: 'America/New_York' },
      Date.UTC(2026, 10, 1, 0, 0),
    );

    expect(new Date(springForward).toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(new Date(fallBack).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
});
