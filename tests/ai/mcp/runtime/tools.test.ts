import { describe, expect, it } from 'vitest';
import { buildMcpRuntimeTools, createMcpRuntimeTools } from '../../../../src/ai/mcp/runtime/tools.js';

describe('createMcpRuntimeTools', () => {
  it('exposes MCP declarations as executable runtime tools', async () => {
    const tools = await createMcpRuntimeTools([
      { name: 'docs', command: 'node ./fake-docs-server.js' },
    ], {
      connect: async () => ({
        listTools: async () => [
          {
            name: 'search',
            description: 'search docs',
            inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
          },
        ],
        callTool: async (_name, input) => `docs:${String(input.q)}`,
        dispose: () => undefined,
      }),
    });

    expect(tools.map((tool) => tool.definition.name)).toEqual(['mcp__docs__search']);
    await expect(tools[0]?.execute({ q: 'prompt cache' })).resolves.toBe('docs:prompt cache');
  });

  it('can build tools from an already connected MCP client', async () => {
    const tools = buildMcpRuntimeTools(
      { name: 'docs', command: 'node ./fake-docs-server.js' },
      {
        listTools: async () => [],
        callTool: async (_name, input) => `docs:${String(input.q)}`,
        dispose: () => undefined,
      },
      [
        {
          name: 'search',
          description: 'search docs',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
      ],
    );

    expect(tools.map((tool) => tool.definition.name)).toEqual(['mcp__docs__search']);
    await expect(tools[0]?.execute({ q: 'cache' })).resolves.toBe('docs:cache');
  });
});
