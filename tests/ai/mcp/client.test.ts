import { describe, it, expect } from 'vitest';
import {
  normalizeMcpToolSchema,
  prefixMcpToolName,
  type McpToolSchema,
} from '../../../src/ai/mcp/client.js';

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

  it('preserves the complete MCP input schema without mutating the source root', () => {
    const inputSchema: McpToolSchema['inputSchema'] & Record<string, unknown> = {
      type: 'object',
      $defs: {
        query: {
          oneOf: [
            { type: 'string', const: 'latest' },
            { type: 'string', enum: ['all', 'recent'] },
          ],
        },
      },
      properties: {
        q: { $ref: '#/$defs/query' },
      },
      required: ['q'],
      'x-kimi-extension': {
        mode: 'verbatim',
      },
    };

    const normalized = normalizeMcpToolSchema('docs', {
      name: 'search',
      description: 'search docs',
      inputSchema,
    });

    expect(normalized.inputSchema).toEqual(inputSchema);
    expect(normalized.inputSchema).not.toBe(inputSchema);
    expect(inputSchema).toEqual({
      type: 'object',
      $defs: {
        query: {
          oneOf: [
            { type: 'string', const: 'latest' },
            { type: 'string', enum: ['all', 'recent'] },
          ],
        },
      },
      properties: {
        q: { $ref: '#/$defs/query' },
      },
      required: ['q'],
      'x-kimi-extension': {
        mode: 'verbatim',
      },
    });
  });
});
