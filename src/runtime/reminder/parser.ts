import type { ReminderParseResult } from './types.js';

export interface ReminderParserOptions {
  now?: () => number;
  timezone: string;
}

const AMBIGUOUS_REQUESTS = [
  /^明早提醒我(.+)$/,
  /^今晚提醒我(.+)$/,
  /^下周一早上提醒我(.+)$/,
] as const;

export function parseReminderRequest(request: string, options: ReminderParserOptions): ReminderParseResult {
  const text = request.trim();
  const now = options.now?.() ?? Date.now();
  const timezone = options.timezone;

  for (const pattern of AMBIGUOUS_REQUESTS) {
    if (pattern.test(text)) {
      return {
        ok: false,
        code: 'needs_confirmation',
        message: '请提供明确的提醒时间，例如“明早 10 点提醒我吃饭”。',
      };
    }
  }

  const relativeMinutes = /^(\d+)\s*分钟后提醒我(.+)$/.exec(text);
  if (relativeMinutes) {
    const minutes = Number(relativeMinutes[1]);
    const content = relativeMinutes[2]?.trim();
    if (!content) {
      return {
        ok: false,
        code: 'invalid',
        message: '提醒内容不能为空。',
      };
    }
    return {
      ok: true,
      content,
      scheduleAt: now + minutes * 60 * 1000,
      timezone,
    };
  }

  const tomorrowExact = /^明天\s*(上午|下午)?\s*(\d{1,2})(?:[:点时](\d{1,2}))?\s*提醒我(.+)$/.exec(text);
  if (tomorrowExact) {
    const meridiem = tomorrowExact[1];
    let hour = Number(tomorrowExact[2]);
    const minute = tomorrowExact[3] ? Number(tomorrowExact[3]) : 0;
    const content = tomorrowExact[4]?.trim();
    if (!content) {
      return {
        ok: false,
        code: 'invalid',
        message: '提醒内容不能为空。',
      };
    }
    if (meridiem === '下午' && hour < 12) {
      hour += 12;
    }
    const tomorrow = addDaysInTimeZone(now, timezone, 1);
    return {
      ok: true,
      content,
      scheduleAt: zonedDateTimeToUtc(
        timezone,
        tomorrow.year,
        tomorrow.month,
        tomorrow.day,
        hour,
        minute,
      ),
      timezone,
    };
  }

  const tomorrowMorning = /^明早\s*(\d{1,2})点(?:([0-5]?\d)分?)?\s*提醒我(.+)$/.exec(text);
  if (tomorrowMorning) {
    const tomorrow = addDaysInTimeZone(now, timezone, 1);
    return {
      ok: true,
      content: tomorrowMorning[3]!.trim(),
      scheduleAt: zonedDateTimeToUtc(
        timezone,
        tomorrow.year,
        tomorrow.month,
        tomorrow.day,
        Number(tomorrowMorning[1]),
        tomorrowMorning[2] ? Number(tomorrowMorning[2]) : 0,
      ),
      timezone,
    };
  }

  return {
    ok: false,
    code: 'invalid',
    message: '暂时只支持“30分钟后提醒我...”或“明天/明早具体时间提醒我...”这类表达。',
  };
}

function addDaysInTimeZone(timestamp: number, timezone: string, days: number): {
  year: number;
  month: number;
  day: number;
} {
  const base = new Date(timestamp + days * 24 * 60 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(base);
  const lookup = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
  };
}

function getTimeZoneOffsetMs(timezone: string, timestamp: number): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const lookup = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  );
  return asUtc - timestamp;
}

function zonedDateTimeToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const firstGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = getTimeZoneOffsetMs(timezone, firstGuess);
  const candidate = firstGuess - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(timezone, candidate);
  return secondOffset === firstOffset ? candidate : firstGuess - secondOffset;
}
