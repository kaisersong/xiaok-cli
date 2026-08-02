import { describe, expect, it, vi } from 'vitest';
import { resolveBuiltinSlideRendererConfig } from '../../../src/platform/mcp/python-server.js';
import type { NamedMcpServerConfig } from '../../../src/platform/mcp/types.js';

function slideServer(): NamedMcpServerConfig {
  return {
    name: 'slide-renderer',
    type: 'stdio',
    command: 'python3',
    args: ['mcp-servers/slide-renderer/server.py'],
    protocol: { mode: 'modern', version: '2026-07-28' },
    source: {
      origin: 'plugin',
      pluginName: 'kai-slide-creator',
      pluginDir: '/plugins/kai-slide-creator',
    },
  };
}

describe('built-in slide renderer Python runtime', () => {
  it('uses the verified managed MCP v2 Python on macOS', async () => {
    const canImportMcpV2 = vi.fn(async () => true);
    const resolved = await resolveBuiltinSlideRendererConfig(slideServer(), {
      platform: 'darwin',
      homeDir: '/Users/test',
      pathExists: () => true,
      canImportMcpV2,
    });

    expect(resolved).toMatchObject({
      command: '/Users/test/.xiaok/runtime/python-env/bin/python3',
      env: {
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });
    expect(canImportMcpV2).toHaveBeenCalledWith('/Users/test/.xiaok/runtime/python-env/bin/python3');
  });

  it('uses the verified managed MCP v2 Python on Windows', async () => {
    const resolved = await resolveBuiltinSlideRendererConfig(slideServer(), {
      platform: 'win32',
      homeDir: 'C:\\Users\\test',
      pathExists: () => true,
      canImportMcpV2: async () => true,
    });

    expect(resolved.command).toBe('C:\\Users\\test\\.xiaok\\runtime\\python-env\\Scripts\\python.exe');
  });

  it('does not reuse an existing managed Python that still lacks MCP v2', async () => {
    const server = slideServer();
    const resolved = await resolveBuiltinSlideRendererConfig(server, {
      platform: 'darwin',
      homeDir: '/Users/test',
      pathExists: () => true,
      canImportMcpV2: async () => false,
    });

    expect(resolved).toBe(server);
  });

  it('does not rewrite third-party Python MCP servers', async () => {
    const server: NamedMcpServerConfig = {
      ...slideServer(),
      name: 'custom-python',
      source: { origin: 'settings' },
    };
    const canImportMcpV2 = vi.fn(async () => true);
    const resolved = await resolveBuiltinSlideRendererConfig(server, {
      platform: 'darwin',
      homeDir: '/Users/test',
      pathExists: () => true,
      canImportMcpV2,
    });

    expect(resolved).toBe(server);
    expect(canImportMcpV2).not.toHaveBeenCalled();
  });
});
