import { describe, it, expect } from 'vitest';
import { estimateTokens, mergeUsage, shouldCompact } from '../../../src/ai/runtime/usage.js';

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
