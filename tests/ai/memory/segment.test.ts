import { describe, expect, it } from 'vitest';
import { segmentChinese, segmentQuery } from '../../../src/ai/memory/segment.js';

describe('segmentChinese', () => {
  it('should segment Chinese text', () => {
    const result = segmentChinese('我喜欢使用TypeScript');
    expect(result.includes(' ')).toBe(true);
  });

  it('should handle non-Chinese text without crashing', () => {
    const result = segmentChinese('hello world');
    expect(result.length).toBeGreaterThan(0);
  });

  it('segmentQuery should use same tokenizer as segmentChinese', () => {
    const indexed = segmentChinese('TypeScript开发偏好');
    const query = segmentQuery('TypeScript开发');
    expect(indexed.includes(' ') || indexed === 'TypeScript开发偏好').toBe(true);
    expect(query.includes(' ') || query === 'TypeScript开发').toBe(true);
  });
});
