import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/types.js';
import { getResumeHistoryMessages } from '../../src/ui/resume-history.js';

const summary = '# Context Summary: synthetic internal context';
const user = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });
const record = { id: 'cmp_test', createdAt: 1, summary, replacedMessages: 8 };

describe('resume history projection', () => {
  it('hides only the provenance-matched leading summary without changing stored messages', () => {
    const messages = [user(summary), user('Visible question'), user(summary)];
    const before = structuredClone(messages);
    expect(getResumeHistoryMessages(messages, [record])).toEqual(messages.slice(1));
    expect(messages).toEqual(before);
  });

  it.each([
    { records: [] },
    { records: [{ ...record, summary: 'different' }] },
    { records: [record, { ...record, summary: 'newer summary' }] },
    { records: [{ ...record, replacedMessages: 0 }] },
    { records: [{ ...record, summary: '' }] },
  ])('preserves unproven user text: %j', ({ records }) => {
    const messages = [user(summary)];
    expect(getResumeHistoryMessages(messages, records)).toEqual(messages);
  });

  it('preserves summary-like headings and system-looking text without provenance', () => {
    const messages = [user('# Context Summary: my actual request'), user('[context compacted summary] my notes')];
    expect(getResumeHistoryMessages(messages)).toEqual(messages);
  });

  it('preserves assistant, multiple-block, and empty messages', () => {
    for (const first of [
      { ...user(summary), role: 'assistant' as const },
      { ...user(summary), content: [...user(summary).content, { type: 'text' as const, text: 'extra' }] },
      user(''),
    ]) {
      expect(getResumeHistoryMessages([first], [record])).toEqual([first]);
    }
    expect(getResumeHistoryMessages([], [record])).toEqual([]);
  });
});
