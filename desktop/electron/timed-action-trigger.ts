import type { TimedActionTrigger } from './timed-action-types.js';

export function validateTrigger(trigger: TimedActionTrigger, minIntervalMinutes?: number): void {
  if (trigger.kind === 'interval') {
    const min = minIntervalMinutes ?? 1;
    if (!Number.isFinite(trigger.intervalMinutes) || trigger.intervalMinutes < min) {
      throw new Error(`intervalMinutes must be at least ${min}`);
    }
  }
}

export function computeInitialDueAt(trigger: TimedActionTrigger, fromTime: number): number {
  if (trigger.kind === 'once') return trigger.at;
  return computeNextDueAt(trigger, fromTime);
}

export function computeNextDueAt(trigger: TimedActionTrigger, fromTime: number): number {
  if (trigger.kind === 'once') return trigger.at;

  if (trigger.kind === 'interval') {
    return fromTime + trigger.intervalMinutes * 60_000;
  }

  const now = new Date(fromTime);

  if (trigger.kind === 'daily') {
    const target = new Date(now);
    target.setHours(trigger.hour, trigger.minute, 0, 0);
    if (target.getTime() <= fromTime) target.setDate(target.getDate() + 1);
    return target.getTime();
  }

  if (trigger.kind === 'weekdays') {
    const target = new Date(now);
    target.setHours(trigger.hour, trigger.minute, 0, 0);
    if (target.getTime() <= fromTime) target.setDate(target.getDate() + 1);
    while (target.getDay() === 0 || target.getDay() === 6) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  const target = new Date(now);
  target.setHours(trigger.hour, trigger.minute, 0, 0);
  const diff = (trigger.dayOfWeek - target.getDay() + 7) % 7;
  if (diff === 0 && target.getTime() <= fromTime) {
    target.setDate(target.getDate() + 7);
  } else {
    target.setDate(target.getDate() + diff);
  }
  return target.getTime();
}

export function countMissedIntervals(trigger: TimedActionTrigger, scheduledDueAt: number, claimedAt: number): number | undefined {
  if (trigger.kind !== 'interval') return undefined;
  const intervalMs = trigger.intervalMinutes * 60_000;
  if (intervalMs <= 0 || claimedAt <= scheduledDueAt) return 0;
  return Math.floor((claimedAt - scheduledDueAt) / intervalMs);
}

