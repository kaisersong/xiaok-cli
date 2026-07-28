import { describe, expect, it, vi } from 'vitest';
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

  it('clones the MCP schema root without invoking or flattening accessors', () => {
    let getterReads = 0;
    const inputSchema: McpToolSchema['inputSchema'] & Record<string, unknown> = {
      type: 'object',
    };
    const getter = () => {
      getterReads += 1;
      return null;
    };
    Object.defineProperty(inputSchema, 'x-accessor', {
      enumerable: true,
      get: getter,
    });

    const descriptorsSpy = vi.spyOn(Object, 'getOwnPropertyDescriptors');
    const normalized = normalizeMcpToolSchema('docs', {
      name: 'search',
      inputSchema,
    });
    const descriptorCloneCalls = descriptorsSpy.mock.calls.length;
    descriptorsSpy.mockRestore();
    const descriptor = Object.getOwnPropertyDescriptor(
      normalized.inputSchema,
      'x-accessor',
    );

    expect(getterReads).toBe(0);
    expect(descriptorCloneCalls).toBe(0);
    expect(descriptor?.get).toBe(getter);
    expect(descriptor).not.toHaveProperty('value');
  });

  it('rejects a Proxy MCP schema root without entering reflection traps', () => {
    let trapCalls = 0;
    const inputSchema = new Proxy<McpToolSchema['inputSchema']>(
      { type: 'object' },
      {
        ownKeys(target) {
          trapCalls += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          trapCalls += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );

    expect(() => normalizeMcpToolSchema('docs', {
      name: 'search',
      inputSchema,
    })).toThrow(TypeError);
    expect(trapCalls).toBe(0);
  });

  it('reads the MCP inputSchema seam once before validating and cloning it', () => {
    let getterReads = 0;
    let trapCalls = 0;
    const firstSchema: McpToolSchema['inputSchema'] = {
      type: 'object',
      properties: {
        first: { type: 'string' },
      },
    };
    const secondSchema = new Proxy<McpToolSchema['inputSchema']>(
      { type: 'object' },
      {
        ownKeys(target) {
          trapCalls += 1;
          return Reflect.ownKeys(target);
        },
      },
    );
    const schema = {
      name: 'search',
    } as McpToolSchema;
    Object.defineProperty(schema, 'inputSchema', {
      get() {
        getterReads += 1;
        return getterReads === 1 ? firstSchema : secondSchema;
      },
    });

    const normalized = normalizeMcpToolSchema('docs', schema);

    expect(getterReads).toBe(1);
    expect(trapCalls).toBe(0);
    expect(normalized.inputSchema).toEqual(firstSchema);
  });
});
