import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_MAX_ITERATIONS,
  resolveAgentMaxIterations,
} from '../../src/commands/chat-runtime-config.js';

describe('resolveAgentMaxIterations', () => {
  it('returns the default when no env override is provided', () => {
    expect(resolveAgentMaxIterations({})).toBe(DEFAULT_AGENT_MAX_ITERATIONS);
  });

  it('honors a positive integer override', () => {
    expect(resolveAgentMaxIterations({ XIAOK_AGENT_MAX_ITERATIONS: '50' })).toBe(50);
  });

  it('floors fractional positive overrides', () => {
    expect(resolveAgentMaxIterations({ XIAOK_AGENT_MAX_ITERATIONS: '7.9' })).toBe(7);
  });

  it('falls back to default for non-numeric values', () => {
    expect(resolveAgentMaxIterations({ XIAOK_AGENT_MAX_ITERATIONS: 'bad' }))
      .toBe(DEFAULT_AGENT_MAX_ITERATIONS);
  });

  it('falls back to default for zero or negative values', () => {
    expect(resolveAgentMaxIterations({ XIAOK_AGENT_MAX_ITERATIONS: '0' }))
      .toBe(DEFAULT_AGENT_MAX_ITERATIONS);
    expect(resolveAgentMaxIterations({ XIAOK_AGENT_MAX_ITERATIONS: '-10' }))
      .toBe(DEFAULT_AGENT_MAX_ITERATIONS);
  });
});
