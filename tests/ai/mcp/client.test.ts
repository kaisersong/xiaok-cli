import { describe, it, expect } from 'vitest';
import { normalizeMcpToolSchema, prefixMcpToolName } from '../../../src/ai/mcp/client.js';

describe('mcp client helpers', () => {
  it('prefixes mcp tool names', () => {
    expect(prefixMcpToolName('docs', 'search')).toBe('mcp__docs__search');
  });

  it('normalizes tool schema', () => {
    expect(normalizeMcpToolSchema('docs', {
      name: 'search',
      description: 'search docs',
      inputSchema: { type: 'object', properties: {}, required: [] },
    }).name).toBe('mcp__docs__search');
  });
});
