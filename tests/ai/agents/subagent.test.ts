import { describe, it, expect } from 'vitest';
import { executeSubAgent } from '../../../src/ai/agents/subagent.js';

describe('executeSubAgent', () => {
  it('runs a subagent with limited tool visibility', async () => {
    const result = await executeSubAgent({
      prompt: 'inspect code',
      allowedTools: ['read', 'grep'],
    });

    expect(result).toContain('inspect code');
    expect(result).toContain('read');
    expect(result).toContain('grep');
  });
});
