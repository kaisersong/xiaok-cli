import { describe, expect, it } from 'vitest';
import {
  appendPaginationNotice,
  paginateItems,
  truncateText,
} from '../../../src/ai/tools/truncation.js';

describe('truncation helpers', () => {
  it('truncates long text with a continuation marker', () => {
    const result = truncateText('abcdefghijklmnopqrstuvwxyz', 12);

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('已截断');
  });

  it('paginates lists and exposes the next offset', () => {
    const page = paginateItems(['a', 'b', 'c', 'd'], 1, 2);

    expect(page.items).toEqual(['b', 'c']);
    expect(page.nextOffset).toBe(3);
  });

  it('adds a pagination hint when more results remain', () => {
    expect(appendPaginationNotice('line1', 20)).toContain('offset=20');
  });
});
