import { describe, expect, it } from 'vitest';

import {
  runCuaMcpReadinessSmoke,
} from '../../electron/cua-driver-manager.js';

describe('CUA driver manager', () => {
  it('accepts a CUA MCP server only after a read-only observation smoke succeeds', async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const result = await runCuaMcpReadinessSmoke({
      schemas: [
        { name: 'click', description: 'click', inputSchema: { type: 'object' } },
        { name: 'list_apps', description: 'list apps', inputSchema: { type: 'object' } },
      ],
      callToolResult: async (name, input) => {
        calls.push({ name, input });
        return {
          text: 'Finder\nSafari',
          images: [],
          structuredContent: { apps: ['Finder', 'Safari'] },
          isError: false,
          summary: 'Finder\nSafari',
        };
      },
    });

    expect(result).toEqual({
      ready: true,
      observationTool: 'list_apps',
      contentTypes: ['text', 'structuredContent'],
    });
    expect(calls).toEqual([{ name: 'list_apps', input: {} }]);
  });

  it('rejects CUA MCP servers that do not expose a safe observation tool', async () => {
    await expect(runCuaMcpReadinessSmoke({
      schemas: [
        { name: 'click', description: 'click', inputSchema: { type: 'object' } },
      ],
      callToolResult: async () => ({
        text: 'clicked',
        images: [],
        isError: false,
        summary: 'clicked',
      }),
    })).resolves.toEqual({
      ready: false,
      code: 'mcp_observation_tool_missing',
    });
  });

  it('rejects observation smoke results that contain no consumable content', async () => {
    await expect(runCuaMcpReadinessSmoke({
      schemas: [
        { name: 'list_apps', description: 'list apps', inputSchema: { type: 'object' } },
      ],
      callToolResult: async () => ({
        text: '',
        images: [],
        isError: false,
        summary: '',
      }),
    })).resolves.toEqual({
      ready: false,
      code: 'mcp_content_unsupported',
      observationTool: 'list_apps',
    });
  });
});
