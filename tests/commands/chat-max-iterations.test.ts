import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_MAX_ITERATIONS,
  resolveAgentMaxIterations,
} from '../../src/commands/chat-runtime-config.js';

describe('resolveAgentMaxIterations', () => {
  it('returns the default when no env override is provided', () => {
    expect(resolveAgentMaxIterations({})).toBeUndefined();
  });

  it('honors a positive integer override', () => {
    expect(resolveAgentMaxIterations({ XIAOK_AGENT_MAX_ITERATIONS: '50' })).toBe(50);
  });

  it.each(['bad','0','-10','7.9',' '])('rejects invalid explicit budget %s', raw => {
    expect(()=>resolveAgentMaxIterations({XIAOK_AGENT_MAX_ITERATIONS:raw})).toThrow('XIAOK_AGENT_MAX_ITERATIONS');
  });
});
