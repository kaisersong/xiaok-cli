import { describe, it, expect } from 'vitest';
import { estimateTokens, mergeUsage, shouldCompact, truncateToolResult } from '../../../src/ai/runtime/usage.js';

describe('runtime usage helpers', () => {
  it('estimates tokens from block content', () => {
    expect(
      estimateTokens([
        { role: 'user', content: [{ type: 'text', text: 'hello world' }] },
      ])
    ).toBeGreaterThan(0);
  });

  it('requests compact when threshold exceeded', () => {
    expect(shouldCompact(180_000, 200_000, 0.85)).toBe(true);
    expect(shouldCompact(80_000, 200_000, 0.85)).toBe(false);
  });

  it('omits optional usage fields when they are undefined', () => {
    expect(
      mergeUsage(
        { inputTokens: 1, outputTokens: 2 },
        { inputTokens: 10, outputTokens: 5 },
      )
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    });
  });
});

describe('truncateToolResult', () => {
  it('returns content unchanged when under threshold', () => {
    const short = 'a'.repeat(7999);
    expect(truncateToolResult(short)).toBe(short);
  });

  it('truncates content exceeding threshold and appends notice', () => {
    const long = 'a'.repeat(12000);
    const result = truncateToolResult(long);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain('truncated');
  });

  it('respects custom threshold', () => {
    const content = 'x'.repeat(200);
    const result = truncateToolResult(content, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain('truncated');
  });
});
