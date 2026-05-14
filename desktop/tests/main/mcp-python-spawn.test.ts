import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('MCP server spawn python command substitution', () => {
  const originalEnv = process.env.XIAOK_PYTHON_CMD;

  beforeEach(() => {
    delete process.env.XIAOK_PYTHON_CMD;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.XIAOK_PYTHON_CMD = originalEnv;
    } else {
      delete process.env.XIAOK_PYTHON_CMD;
    }
  });

  // Replicate the command substitution logic from desktop-services.ts
  function resolveCommand(serverCommand: string): string {
    return (serverCommand === 'python3' || serverCommand === 'python')
      ? (process.env.XIAOK_PYTHON_CMD || serverCommand)
      : serverCommand;
  }

  it('uses XIAOK_PYTHON_CMD when set and command is python3', () => {
    process.env.XIAOK_PYTHON_CMD = '/home/user/.xiaok/runtime/python-env/bin/python3';
    expect(resolveCommand('python3')).toBe('/home/user/.xiaok/runtime/python-env/bin/python3');
  });

  it('uses XIAOK_PYTHON_CMD when set and command is python', () => {
    process.env.XIAOK_PYTHON_CMD = '/home/user/.xiaok/runtime/python-env/bin/python3';
    expect(resolveCommand('python')).toBe('/home/user/.xiaok/runtime/python-env/bin/python3');
  });

  it('falls back to original command when XIAOK_PYTHON_CMD is not set', () => {
    expect(resolveCommand('python3')).toBe('python3');
    expect(resolveCommand('python')).toBe('python');
  });

  it('does not substitute node command', () => {
    process.env.XIAOK_PYTHON_CMD = '/some/venv/python3';
    expect(resolveCommand('node')).toBe('node');
  });

  it('does not substitute arbitrary commands', () => {
    process.env.XIAOK_PYTHON_CMD = '/some/venv/python3';
    expect(resolveCommand('ruby')).toBe('ruby');
    expect(resolveCommand('/usr/bin/custom')).toBe('/usr/bin/custom');
  });

  it('handles Windows-style venv path', () => {
    process.env.XIAOK_PYTHON_CMD = 'C:\\Users\\user\\.xiaok\\runtime\\python-env\\Scripts\\python.exe';
    expect(resolveCommand('python3')).toBe('C:\\Users\\user\\.xiaok\\runtime\\python-env\\Scripts\\python.exe');
    expect(resolveCommand('python')).toBe('C:\\Users\\user\\.xiaok\\runtime\\python-env\\Scripts\\python.exe');
  });
});
