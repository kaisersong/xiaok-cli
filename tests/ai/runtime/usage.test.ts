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

  it('preserves base values when next has zero tokens (message_delta scenario)', () => {
    // message_start: { inputTokens: 5000, outputTokens: 0 }
    // message_delta: { inputTokens: 0, outputTokens: 300 }
    const afterStart = mergeUsage(
      { inputTokens: 0, outputTokens: 0 },
      { inputTokens: 5000, outputTokens: 100 },
    );
    expect(afterStart).toEqual({ inputTokens: 5000, outputTokens: 100 });

    const afterDelta = mergeUsage(
      afterStart,
      { inputTokens: 0, outputTokens: 300 },
    );
    // inputTokens should be preserved from message_start
    expect(afterDelta.inputTokens).toBe(5000);
    expect(afterDelta.outputTokens).toBe(300);
  });

  it('fully replaces when next has non-zero for both', () => {
    expect(
      mergeUsage(
        { inputTokens: 5000, outputTokens: 100 },
        { inputTokens: 6000, outputTokens: 200 },
      )
    ).toEqual({
      inputTokens: 6000,
      outputTokens: 200,
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
