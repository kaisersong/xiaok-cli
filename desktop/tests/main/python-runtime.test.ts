import { describe, expect, it, vi } from 'vitest';
import {
  buildPythonServerEnv,
  resolvePythonServerLaunch,
  detectPythonCompatibilityTag,
  ensureSlideRendererPythonReady,
  isCompatibleSlideRendererWheelhouse,
  normalizePythonServerCommand,
  type PythonExecFile,
} from '../../electron/python-runtime.js';

describe('python runtime helper', () => {
  it('returns ready immediately when imports already work', async () => {
    const exec: PythonExecFile = vi.fn(async (_command, args) => {
      if (args[1] === '-c') return;
      throw new Error(`unexpected args: ${args.join(' ')}`);
    });

    const result = await ensureSlideRendererPythonReady({
      venvPython: 'C:\\runtime\\python.exe',
      wheelsDir: 'C:\\wheels',
      markerPath: 'C:\\runtime\\.deps-installed',
      exec,
    });

    expect(result).toEqual({ ready: true, mode: 'existing' });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('C:\\runtime\\python.exe', [
      '-B', '-c',
      expect.stringContaining('from mcp.server.mcpserver import MCPServer'),
    ], expect.objectContaining({ timeout: 15_000, env: expect.objectContaining({ PYTHONDONTWRITEBYTECODE: '1' }) }));
    expect((exec as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.[2]).toContain("version('mcp') == '2.3.0'");
  });

  it('falls back to online pip install when offline wheel install fails', async () => {
    const exec: PythonExecFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('No module named mcp'))
      .mockRejectedValueOnce(new Error('wheel not supported on this platform'))
      .mockRejectedValueOnce(new Error('No module named mcp'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const markerWrites: string[] = [];
    const result = await ensureSlideRendererPythonReady({
      venvPython: 'C:\\runtime\\python.exe',
      wheelsDir: 'C:\\wheels',
      markerPath: 'C:\\runtime\\.deps-installed',
      exec,
      writeMarker: (markerPath) => markerWrites.push(markerPath),
    });

    expect(result).toEqual({ ready: true, mode: 'online' });
    expect(exec).toHaveBeenNthCalledWith(2, 'C:\\runtime\\python.exe', [
      '-B', '-m', 'pip', 'install', '--no-index', '--find-links', 'C:\\wheels',
      'mcp==2.3.0', 'pydantic==2.13.4', 'jsonschema==4.26.0', 'beautifulsoup4',
    ], expect.objectContaining({ timeout: 60_000, env: expect.objectContaining({ PYTHONDONTWRITEBYTECODE: '1' }) }));
    expect(exec).toHaveBeenNthCalledWith(4, 'C:\\runtime\\python.exe', [
      '-B', '-m', 'pip', 'install',
      'mcp==2.3.0', 'pydantic==2.13.4', 'jsonschema==4.26.0', 'beautifulsoup4',
    ], expect.objectContaining({ timeout: 120_000, env: expect.objectContaining({ PYTHONDONTWRITEBYTECODE: '1' }) }));
    expect(markerWrites).toEqual(['C:\\runtime\\.deps-installed']);
  });

  it('upgrades a stale MCP v1 environment even when the top-level mcp import exists', async () => {
    const exec: PythonExecFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('No module named mcp.server.mcpserver'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const result = await ensureSlideRendererPythonReady({
      venvPython: '/runtime/bin/python3',
      wheelsDir: '/wheels',
      markerPath: '/runtime/.deps-installed',
      exec,
    });

    expect(result).toEqual({ ready: true, mode: 'offline' });
    expect(exec).toHaveBeenNthCalledWith(2, '/runtime/bin/python3', [
      '-B', '-m', 'pip', 'install', '--no-index', '--find-links', '/wheels',
      'mcp==2.3.0', 'pydantic==2.13.4', 'jsonschema==4.26.0', 'beautifulsoup4',
    ], expect.objectContaining({ timeout: 60_000, env: expect.objectContaining({ PYTHONDONTWRITEBYTECODE: '1' }) }));
  });

  it('does not trust a stale marker when imports are still broken', async () => {
    const exec: PythonExecFile = vi.fn().mockRejectedValue(new Error('No module named mcp'));
    const result = await ensureSlideRendererPythonReady({
      venvPython: 'C:\\runtime\\python.exe',
      wheelsDir: 'C:\\wheels',
      markerPath: 'C:\\runtime\\.deps-installed',
      exec,
      markerExists: true,
    });

    expect(result).toEqual({ ready: false, mode: 'failed' });
  });

  it('normalizes python3 to python on Windows when no managed venv is ready', () => {
    expect(normalizePythonServerCommand('python3', 'win32')).toBe('python');
    expect(normalizePythonServerCommand('python', 'win32')).toBe('python');
  });

  it('prefers managed python command when provided', () => {
    expect(normalizePythonServerCommand('python3', 'win32', 'C:\\runtime\\python.exe')).toBe('C:\\runtime\\python.exe');
  });

  it('forces utf-8 env for python MCP subprocesses on Windows', () => {
    expect(buildPythonServerEnv({ EXISTING: '1' })).toEqual({
      EXISTING: '1',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    });
  });

  it('detects the managed python compatibility tag', async () => {
    const exec: PythonExecFile = vi.fn(async () => ({ stdout: 'cp311\n' }));

    await expect(detectPythonCompatibilityTag('/runtime/bin/python3', exec)).resolves.toBe('cp311');
    expect(exec).toHaveBeenCalledWith('/runtime/bin/python3', [
      '-B', '-c',
      'import sys; print(f"cp{sys.version_info[0]}{sys.version_info[1]}")',
    ], expect.objectContaining({ timeout: 15_000, env: expect.objectContaining({ PYTHONDONTWRITEBYTECODE: '1' }) }));
  });

  it('rejects macOS native wheels for Windows offline slide-renderer installs', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-2.3.0-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'pydantic_core-2.46.4-cp311-cp311-macosx_11_0_arm64.whl',
      'rpds_py-0.30.0-cp311-cp311-macosx_11_0_arm64.whl',
    ], 'win32', 'x64')).toBe(false);
  });

  it('accepts Windows native wheels for Windows offline slide-renderer installs', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-2.3.0-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'pydantic_core-2.46.4-cp311-cp311-win_amd64.whl',
      'rpds_py-0.30.0-cp311-cp311-win_amd64.whl',
      'pywin32-311-cp311-cp311-win_amd64.whl',
      'colorama-0.4.6-py2.py3-none-any.whl',
    ], 'win32', 'x64', 'cp311')).toBe(true);
  });

  it('rejects Windows wheelhouses without mandatory Windows-only dependencies', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-2.3.0-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'pydantic_core-2.46.4-cp311-cp311-win_amd64.whl',
      'rpds_py-0.30.0-cp311-cp311-win_amd64.whl',
    ], 'win32', 'x64', 'cp311')).toBe(false);
  });

  it('rejects same-platform native wheels when the Python ABI tag does not match', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-2.3.0-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'pydantic_core-2.46.4-cp314-cp314-macosx_11_0_arm64.whl',
      'rpds_py-0.30.0-cp314-cp314-macosx_11_0_arm64.whl',
    ], 'darwin', 'arm64', 'cp311')).toBe(false);
  });

  it('accepts same-platform native wheels when the Python ABI tag matches', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-2.3.0-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'pydantic_core-2.46.4-cp314-cp314-macosx_11_0_arm64.whl',
      'rpds_py-0.30.0-cp314-cp314-macosx_11_0_arm64.whl',
    ], 'darwin', 'arm64', 'cp314')).toBe(true);
  });

  it('ignores Windows-only native wheels in a mixed macOS wheelhouse', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-2.3.0-py3-none-any.whl',
      'pydantic_core-2.46.4-cp311-cp311-macosx_11_0_arm64.whl',
      'rpds_py-2026.6.3-cp311-cp311-macosx_11_0_arm64.whl',
      'pywin32-312-cp314-cp314-win_amd64.whl',
      'colorama-0.4.6-py2.py3-none-any.whl',
    ], 'darwin', 'arm64', 'cp311')).toBe(true);
  });

  it('rejects wheelhouses with another native dependency for a different Python ABI', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-2.3.0-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'pydantic_core-2.46.4-cp311-cp311-macosx_11_0_arm64.whl',
      'rpds_py-0.30.0-cp311-cp311-macosx_11_0_arm64.whl',
      'cffi-2.0.0-cp314-cp314-macosx_11_0_arm64.whl',
    ], 'darwin', 'arm64', 'cp311')).toBe(false);
  });

  it('rejects pure-only wheelhouses because pydantic-core needs a native wheel', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-2.3.0-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'jsonschema-4.26.0-py3-none-any.whl',
    ], 'linux', 'x64')).toBe(false);
  });
});


describe('Python launch policy', () => {
  it.each(['darwin', 'win32'] as const)('protects the actual managed runtime on %s including custom isolated plugins', (platform) => {
    const args = ['-I', '-E', 'custom.py'];
    const env = { KEEP: 'sentinel', PYTHONDONTWRITEBYTECODE: '' };
    const result = resolvePythonServerLaunch({ command: 'python3', args, env, platform, preferredPython: '/owned/python' });
    expect(result).toEqual({ command: '/owned/python', args: ['-B', ...args], env: { ...env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    expect(args).toEqual(['-I', '-E', 'custom.py']);
    expect(env).toEqual({ KEEP: 'sentinel', PYTHONDONTWRITEBYTECODE: '' });
  });

  it('preserves unmanaged Python fallback arguments and policy', () => {
    const args = ['-E', 'custom.py'];
    const env = { PYTHONDONTWRITEBYTECODE: '', KEEP: 'sentinel' };
    const result = resolvePythonServerLaunch({ command: 'python3', args, env, platform: 'win32' });
    expect(result).toEqual({ command: 'python', args, env: { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    expect(result.args).toBe(args);
  });

  it.each(['/custom/python', 'node', 'cua-driver'])('does not route or change an explicit non-managed command %s', (command) => {
    const args = ['server.py'];
    const env = { KEEP: 'sentinel' };
    const result = resolvePythonServerLaunch({ command, args, env, platform: 'darwin', preferredPython: '/owned/python' });
    expect(result).toEqual({ command, args, env });
    expect(result.args).toBe(args);
    expect(result.env).toBe(env);
  });
});
