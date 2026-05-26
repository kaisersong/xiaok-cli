import { describe, expect, it } from 'vitest';

import {
  buildCuaDriverDaemonLaunch,
  isProbablyEmptyCaptureImage,
  prelaunchCuaDriverDaemonForMcp,
  runCuaMcpReadinessSmoke,
  shouldPrelaunchCuaDriverDaemonForMcp,
} from '../../electron/cua-driver-manager.js';

describe('CUA driver manager', () => {
  it('launches the daemon through the exact CuaDriver.app path instead of app-name resolution', () => {
    expect(buildCuaDriverDaemonLaunch()).toEqual({
      command: 'open',
      args: ['-n', '-g', '/Applications/CuaDriver.app', '--args', 'serve'],
    });
    expect(buildCuaDriverDaemonLaunch().args).not.toContain('-a');
  });

  it('prelaunches only the real macOS CUA driver binary before MCP startup', () => {
    expect(shouldPrelaunchCuaDriverDaemonForMcp(
      'cua-driver',
      '/Users/alice/.local/bin/cua-driver',
      'darwin',
      (path) => path === '/Applications/CuaDriver.app/Contents/MacOS/cua-driver',
    )).toBe(true);

    expect(shouldPrelaunchCuaDriverDaemonForMcp(
      'cua-driver',
      process.execPath,
      'darwin',
      () => true,
    )).toBe(false);

    expect(shouldPrelaunchCuaDriverDaemonForMcp(
      'other-server',
      '/Users/alice/.local/bin/cua-driver',
      'darwin',
      () => true,
    )).toBe(false);
  });

  it('runs the exact-path daemon launch when CUA MCP is about to start', () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    const launched = prelaunchCuaDriverDaemonForMcp('cua-driver', '/Users/alice/.local/bin/cua-driver', {
      platform: 'darwin',
      fileExists: (path) => path === '/Applications/CuaDriver.app/Contents/MacOS/cua-driver',
      runOpen: (command, args) => {
        calls.push({ command, args });
        return { status: 0 };
      },
    });

    expect(launched).toBe(true);
    expect(calls).toEqual([{
      command: 'open',
      args: ['-n', '-g', '/Applications/CuaDriver.app', '--args', 'serve'],
    }]);
  });

  it('accepts a CUA MCP server only after the v0.2 window observation smoke succeeds', async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const result = await runCuaMcpReadinessSmoke({
      schemas: [
        { name: 'click', description: 'click', inputSchema: { type: 'object' } },
        { name: 'list_apps', description: 'list apps', inputSchema: { type: 'object' } },
        { name: 'list_windows', description: 'list windows', inputSchema: { type: 'object' } },
        { name: 'get_window_state', description: 'get window state', inputSchema: { type: 'object' } },
      ],
      callToolResult: async (name, input) => {
        calls.push({ name, input });
        return {
          text: 'Safari: 1 window',
          images: [],
          structuredContent: { windows: [{ app_name: 'Safari', pid: 123, window_id: 456 }] },
          isError: false,
          summary: 'Safari: 1 window',
        };
      },
    });

    expect(result).toEqual({
      ready: true,
      observationTool: 'list_windows',
      contentTypes: ['text', 'structuredContent'],
    });
    expect(calls).toEqual([{ name: 'list_windows', input: { on_screen_only: true } }]);
  });

  it('rejects CUA MCP servers that do not expose the v0.2 window tools used by the wrapper', async () => {
    await expect(runCuaMcpReadinessSmoke({
      schemas: [
        { name: 'click', description: 'click', inputSchema: { type: 'object' } },
        { name: 'list_apps', description: 'list apps', inputSchema: { type: 'object' } },
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
        { name: 'list_windows', description: 'list windows', inputSchema: { type: 'object' } },
        { name: 'get_window_state', description: 'get window state', inputSchema: { type: 'object' } },
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
      observationTool: 'list_windows',
    });
  });

  it('detects empty capture images so stale TCC permission is not treated as ready', () => {
    expect(isProbablyEmptyCaptureImage({ mimeType: 'image/png', data: Buffer.alloc(128, 0).toString('base64') })).toBe(true);
    expect(isProbablyEmptyCaptureImage({ mimeType: 'image/png', data: Buffer.from('not-all-empty-image-bytes').toString('base64') })).toBe(false);
  });
});
