import { describe, expect, it } from 'vitest';
import { parseReminderRequest } from '../../../src/runtime/reminder/parser.js';

describe('reminder parser', () => {
  it('parses relative minute reminders into an absolute due time', () => {
    const now = Date.UTC(2026, 3, 19, 1, 0, 0);
    const parsed = parseReminderRequest('30分钟后提醒我发日报', {
      now: () => now,
      timezone: 'Asia/Shanghai',
    });

    expect(parsed).toMatchObject({
      ok: true,
      content: '发日报',
      timezone: 'Asia/Shanghai',
      scheduleAt: now + 30 * 60 * 1000,
    });
  });

  it('asks for clarification when the request has an ambiguous time phrase', () => {
    const parsed = parseReminderRequest('明早提醒我吃饭', {
      now: () => Date.UTC(2026, 3, 19, 1, 0, 0),
      timezone: 'Asia/Shanghai',
    });

    expect(parsed).toEqual({
      ok: false,
      code: 'needs_confirmation',
      message: '请提供明确的提醒时间，例如“明早 10 点提醒我吃饭”。',
    });
  });
});
