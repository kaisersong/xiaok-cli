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

  it('keeps ordinary MCP tools safe by default but treats CUA action tools as write-permission', () => {
    const docsTools = buildMcpRuntimeTools(
      { name: 'docs', command: 'node ./fake-docs-server.js' },
      {
        listTools: async () => [],
        callTool: async () => 'ok',
        dispose: () => undefined,
      },
      [
        {
          name: 'search',
          description: 'search docs',
          inputSchema: { type: 'object' },
        },
      ],
    );

    const cuaTools = buildMcpRuntimeTools(
      { name: 'cua-driver', command: 'cua-driver mcp' },
      {
        listTools: async () => [],
        callTool: async () => 'ok',
        dispose: () => undefined,
      },
      [
        {
          name: 'click',
          description: 'click the current app',
          inputSchema: { type: 'object' },
        },
        {
          name: 'unknown_future_action',
          description: 'new driver action',
          inputSchema: { type: 'object' },
        },
        {
          name: 'get_app_state',
          description: 'read app state',
          inputSchema: { type: 'object' },
        },
      ],
    );

    expect(docsTools[0]?.permission).toBe('safe');
    expect(cuaTools.map((tool) => [tool.definition.name, tool.permission])).toEqual([
      ['mcp__cua-driver__click', 'write'],
      ['mcp__cua-driver__unknown_future_action', 'write'],
      ['mcp__cua-driver__get_app_state', 'safe'],
    ]);
  });
});
