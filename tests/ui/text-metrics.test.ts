import { describe, expect, it } from 'vitest';
import {
  getDisplayWidth,
  moveOffsetLeft,
  moveOffsetRight,
  offsetToDisplayColumn,
  sliceByDisplayColumns,
} from '../../src/ui/text-metrics.js';

describe('text-metrics', () => {
  it('measures mixed CJK and ASCII width', () => {
    expect(getDisplayWidth('为什么没有调用kai-report-creator')).toBe(32);
  });

  it('moves across mixed-width text one logical character at a time', () => {
    const text = '为什么a';
    expect(moveOffsetLeft(text, text.length)).toBe(text.length - 1);
    expect(moveOffsetRight(text, 0)).toBe(1);
  });

  it('converts offsets to display columns', () => {
    expect(offsetToDisplayColumn('写一个a', 0)).toBe(0);
    expect(offsetToDisplayColumn('写一个a', 1)).toBe(2);
    expect(offsetToDisplayColumn('写一个a', 4)).toBe(7);
  });

  it('slices text by visible display width', () => {
    expect(sliceByDisplayColumns('写一个xiaok', 0, 6)).toBe('写一个');
    expect(sliceByDisplayColumns('写一个xiaok', 6, 5)).toBe('xiaok');
  });
});
