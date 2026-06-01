import { describe, expect, it, vi } from 'vitest';
import {
  buildPythonServerEnv,
  detectPythonCompatibilityTag,
  ensureSlideRendererPythonReady,
  isCompatibleSlideRendererWheelhouse,
  normalizePythonServerCommand,
  type PythonExecFile,
} from '../../electron/python-runtime.js';

describe('python runtime helper', () => {
  it('returns ready immediately when imports already work', async () => {
    const exec: PythonExecFile = vi.fn(async (_command, args) => {
      if (args[0] === '-c') return;
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
      '-m', 'pip', 'install', '--no-index', '--find-links', 'C:\\wheels',
      'mcp==1.27.1', 'pydantic==2.13.4', 'jsonschema==4.26.0', 'beautifulsoup4',
    ], { timeout: 60_000 });
    expect(exec).toHaveBeenNthCalledWith(4, 'C:\\runtime\\python.exe', [
      '-m', 'pip', 'install',
      'mcp==1.27.1', 'pydantic==2.13.4', 'jsonschema==4.26.0', 'beautifulsoup4',
    ], { timeout: 120_000 });
    expect(markerWrites).toEqual(['C:\\runtime\\.deps-installed']);
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
      '-c',
      'import sys; print(f"cp{sys.version_info[0]}{sys.version_info[1]}")',
    ], { timeout: 15_000 });
  });

  it('rejects macOS native wheels for Windows offline slide-renderer installs', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-1.27.1-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'pydantic_core-2.46.4-cp311-cp311-macosx_11_0_arm64.whl',
      'rpds_py-0.30.0-cp311-cp311-macosx_11_0_arm64.whl',
    ], 'win32', 'x64')).toBe(false);
  });

  it('accepts Windows native wheels for Windows offline slide-renderer installs', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-1.27.1-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'pydantic_core-2.46.4-cp311-cp311-win_amd64.whl',
      'rpds_py-0.30.0-cp311-cp311-win_amd64.whl',
    ], 'win32', 'x64', 'cp311')).toBe(true);
  });

  it('rejects same-platform native wheels when the Python ABI tag does not match', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-1.27.1-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'pydantic_core-2.46.4-cp314-cp314-macosx_11_0_arm64.whl',
      'rpds_py-0.30.0-cp314-cp314-macosx_11_0_arm64.whl',
    ], 'darwin', 'arm64', 'cp311')).toBe(false);
  });

  it('accepts same-platform native wheels when the Python ABI tag matches', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-1.27.1-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'pydantic_core-2.46.4-cp314-cp314-macosx_11_0_arm64.whl',
      'rpds_py-0.30.0-cp314-cp314-macosx_11_0_arm64.whl',
    ], 'darwin', 'arm64', 'cp314')).toBe(true);
  });

  it('rejects wheelhouses with another native dependency for a different Python ABI', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-1.27.1-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'pydantic_core-2.46.4-cp311-cp311-macosx_11_0_arm64.whl',
      'rpds_py-0.30.0-cp311-cp311-macosx_11_0_arm64.whl',
      'cffi-2.0.0-cp314-cp314-macosx_11_0_arm64.whl',
    ], 'darwin', 'arm64', 'cp311')).toBe(false);
  });

  it('rejects pure-only wheelhouses because pydantic-core needs a native wheel', () => {
    expect(isCompatibleSlideRendererWheelhouse([
      'mcp-1.27.1-py3-none-any.whl',
      'pydantic-2.13.4-py3-none-any.whl',
      'jsonschema-4.26.0-py3-none-any.whl',
    ], 'linux', 'x64')).toBe(false);
  });
});
