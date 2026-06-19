import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MCP_CALL_TIMEOUT_MS,
  DEFAULT_MCP_STARTUP_TIMEOUT_MS,
  resolveMcpCallToolTimeoutMs,
  resolveMcpStartupTimeoutMs,
  resolveStdioCommand,
} from '../../../src/platform/mcp/transport.js';

describe('MCP transport helpers', () => {
  it('resolves startup timeout with an environment override', () => {
    expect(resolveMcpStartupTimeoutMs({})).toBe(DEFAULT_MCP_STARTUP_TIMEOUT_MS);
    expect(resolveMcpStartupTimeoutMs({ XIAOK_MCP_STARTUP_TIMEOUT_MS: '75' })).toBe(75);
    expect(resolveMcpStartupTimeoutMs({ XIAOK_MCP_STARTUP_TIMEOUT_MS: 'bad' })).toBe(DEFAULT_MCP_STARTUP_TIMEOUT_MS);
  });

  it('resolves callTool timeout with an environment override', () => {
    expect(resolveMcpCallToolTimeoutMs({})).toBe(DEFAULT_MCP_CALL_TIMEOUT_MS);
    expect(resolveMcpCallToolTimeoutMs({ XIAOK_MCP_CALL_TIMEOUT_MS: '5000' })).toBe(5000);
    expect(resolveMcpCallToolTimeoutMs({ XIAOK_MCP_CALL_TIMEOUT_MS: 'bad' })).toBe(DEFAULT_MCP_CALL_TIMEOUT_MS);
    expect(resolveMcpCallToolTimeoutMs({ XIAOK_MCP_CALL_TIMEOUT_MS: '0' })).toBe(DEFAULT_MCP_CALL_TIMEOUT_MS);
    expect(resolveMcpCallToolTimeoutMs({ XIAOK_MCP_CALL_TIMEOUT_MS: '-100' })).toBe(DEFAULT_MCP_CALL_TIMEOUT_MS);
  });

  it('normalizes python3 on Windows and honors explicit Python command override', () => {
    expect(resolveStdioCommand('python3', 'win32', {})).toBe('python');
    expect(resolveStdioCommand('python3', 'linux', {})).toBe('python3');
    expect(resolveStdioCommand('python3', 'win32', { XIAOK_PYTHON_CMD: 'C:\\runtime\\python.exe' }))
      .toBe('C:\\runtime\\python.exe');
    expect(resolveStdioCommand('node', 'win32', { XIAOK_PYTHON_CMD: 'C:\\runtime\\python.exe' })).toBe('node');
  });
});
