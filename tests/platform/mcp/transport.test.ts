import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MCP_STARTUP_TIMEOUT_MS,
  resolveMcpStartupTimeoutMs,
  resolveStdioCommand,
} from '../../../src/platform/mcp/transport.js';

describe('MCP transport helpers', () => {
  it('resolves startup timeout with an environment override', () => {
    expect(resolveMcpStartupTimeoutMs({})).toBe(DEFAULT_MCP_STARTUP_TIMEOUT_MS);
    expect(resolveMcpStartupTimeoutMs({ XIAOK_MCP_STARTUP_TIMEOUT_MS: '75' })).toBe(75);
    expect(resolveMcpStartupTimeoutMs({ XIAOK_MCP_STARTUP_TIMEOUT_MS: 'bad' })).toBe(DEFAULT_MCP_STARTUP_TIMEOUT_MS);
  });

  it('normalizes python3 on Windows and honors explicit Python command override', () => {
    expect(resolveStdioCommand('python3', 'win32', {})).toBe('python');
    expect(resolveStdioCommand('python3', 'linux', {})).toBe('python3');
    expect(resolveStdioCommand('python3', 'win32', { XIAOK_PYTHON_CMD: 'C:\\runtime\\python.exe' }))
      .toBe('C:\\runtime\\python.exe');
    expect(resolveStdioCommand('node', 'win32', { XIAOK_PYTHON_CMD: 'C:\\runtime\\python.exe' })).toBe('node');
  });
});
