import type { TimedActionTrigger } from './timed-action-types.js';

export function validateTrigger(trigger: TimedActionTrigger, minIntervalMinutes?: number): void {
  if (trigger.kind === 'interval') {
    const min = minIntervalMinutes ?? 0.5;
    if (!Number.isFinite(trigger.intervalMinutes) || trigger.intervalMinutes < min) {
      throw new Error(`intervalMinutes must be at least ${min}`);
    }
  }
  if (trigger.kind === 'daily' && trigger.timeZone) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: trigger.timeZone }).format(0); }
    catch { throw new Error(`Invalid IANA timeZone: ${trigger.timeZone}`); }
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
    if (trigger.timeZone || trigger.daysOfWeek) return computeZonedDailyDueAt(trigger, fromTime);
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

function computeZonedDailyDueAt(
  trigger: Extract<TimedActionTrigger, { kind: 'daily' }>,
  fromTime: number,
): number {
  const timeZone = trigger.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = zonedParts(fromTime, timeZone);
  const allowedDays = trigger.daysOfWeek ? new Set(trigger.daysOfWeek) : undefined;
  for (let offset = 0; offset <= 8; offset += 1) {
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    if (allowedDays && !allowedDays.has(date.getUTCDay())) continue;
    const dueAt = findZonedDailyInstant(year, month, day, trigger.hour, trigger.minute, timeZone);
    if (dueAt > fromTime) return dueAt;
  }
  throw new Error('Could not resolve the next timezone-aware daily trigger.');
}

function findZonedDailyInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const start = Date.UTC(year, month - 1, day, 0, 0) - 18 * 60 * 60_000;
  const end = start + 48 * 60 * 60_000;
  let firstAfterGap: number | undefined;
  for (let instant = start; instant <= end; instant += 60_000) {
    const parts = zonedParts(instant, timeZone);
    if (parts.year !== year || parts.month !== month || parts.day !== day) continue;
    if (parts.hour === hour && parts.minute === minute) return instant;
    if (firstAfterGap === undefined && parts.hour * 60 + parts.minute > hour * 60 + minute) firstAfterGap = instant;
  }
  if (firstAfterGap !== undefined) return firstAfterGap;
  throw new Error('Could not resolve timezone-aware daily wall time.');
}

function zonedParts(instant: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const value = (kind: string) => Number(parts.find(part => part.type === kind)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}

export function countMissedIntervals(trigger: TimedActionTrigger, scheduledDueAt: number, claimedAt: number): number | undefined {
  if (trigger.kind !== 'interval') return undefined;
  const intervalMs = trigger.intervalMinutes * 60_000;
  if (intervalMs <= 0 || claimedAt <= scheduledDueAt) return 0;
  return Math.floor((claimedAt - scheduledDueAt) / intervalMs);
}
