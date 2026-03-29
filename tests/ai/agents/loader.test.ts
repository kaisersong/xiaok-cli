import { describe, it, expect } from 'vitest';
import { parseAgentFile } from '../../../src/ai/agents/loader.js';

describe('custom agent loader', () => {
  it('parses tools, model and max_iterations', () => {
    const agent = parseAgentFile(
      'reviewer',
      '---\ntools: read,grep\nmodel: claude\nmax_iterations: 5\n---\nYou are a reviewer.',
    );

    expect(agent.allowedTools).toEqual(['read', 'grep']);
    expect(agent.model).toBe('claude');
    expect(agent.maxIterations).toBe(5);
    expect(agent.systemPrompt).toBe('You are a reviewer.');
  });
});
