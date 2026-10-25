import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildManagedPythonChildEnv, resolveBuiltinSlideRendererConfig } from '../../../src/platform/mcp/python-server.js';
import type { NamedMcpServerConfig } from '../../../src/platform/mcp/types.js';

const child = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: child.execFile }));
beforeEach(() => {
  child.execFile.mockReset();
  child.execFile.mockImplementation((_command: string, _args: string[], _options: object, callback: (error: Error | null, stdout: string, stderr: string) => void) => callback(null, '', ''));
});

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
        PYTHONDONTWRITEBYTECODE: '1',
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

    if (resolved.type !== 'stdio') throw new Error('expected_stdio_slide_renderer_config');
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


describe('managed Python bytecode policy', () => {
  it('copies policy without mutating the inherited environment', () => {
    const base = { KEEP: 'sentinel', PYTHONDONTWRITEBYTECODE: '' };
    expect(buildManagedPythonChildEnv(base)).toEqual({ KEEP: 'sentinel', PYTHONDONTWRITEBYTECODE: '1' });
    expect(base).toEqual({ KEEP: 'sentinel', PYTHONDONTWRITEBYTECODE: '' });
  });

  it('protects the real default import probe before selecting the managed server', async () => {
    const server = slideServer();
    if (server.type !== 'stdio') throw new Error('expected_stdio');
    server.args = ['-I', '-E', 'server.py'];
    server.env = { KEEP: 'sentinel', PYTHONDONTWRITEBYTECODE: '' };
    const resolved = await resolveBuiltinSlideRendererConfig(server, { platform: 'darwin', homeDir: '/Users/test', pathExists: () => true });
    if (resolved.type !== 'stdio') throw new Error('expected_stdio');
    expect(child.execFile).toHaveBeenCalledWith('/Users/test/.xiaok/runtime/python-env/bin/python3', ['-B', '-c', 'from mcp.server.mcpserver import MCPServer'], expect.objectContaining({ timeout: 15_000, env: expect.objectContaining({ PYTHONDONTWRITEBYTECODE: '1' }) }), expect.any(Function));
    expect(resolved.args).toEqual(['-B', '-I', '-E', 'server.py']);
    expect(resolved.env).toEqual({ KEEP: 'sentinel', PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
    expect(server.args).toEqual(['-I', '-E', 'server.py']);
    expect(server.env.PYTHONDONTWRITEBYTECODE).toBe('');
  });

  it('retains the original server when the actual managed probe fails', async () => {
    child.execFile.mockImplementationOnce((_command: string, _args: string[], _options: object, callback: (error: Error) => void) => callback(new Error('missing dependency')));
    const server = slideServer();
    await expect(resolveBuiltinSlideRendererConfig(server, { platform: 'darwin', homeDir: '/Users/test', pathExists: () => true })).resolves.toBe(server);
  });
});
