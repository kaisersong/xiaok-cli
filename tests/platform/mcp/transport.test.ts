import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MCP_CATALOG_TIMEOUT_MS,
  DEFAULT_MCP_CALL_TIMEOUT_MS,
  DEFAULT_MCP_RESOURCE_TIMEOUT_MS,
  DEFAULT_MCP_STARTUP_TIMEOUT_MS,
  resolveMcpCatalogTimeoutMs,
  resolveMcpCallToolTimeoutMs,
  resolveMcpClientVersion,
  resolveMcpResourceTimeoutMs,
  resolveMcpStartupTimeoutMs,
  resolveStdioCommand,
  tryConnect,
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

  it('resolves catalog and resource timeouts with independent environment overrides', () => {
    expect(resolveMcpCatalogTimeoutMs({})).toBe(DEFAULT_MCP_CATALOG_TIMEOUT_MS);
    expect(resolveMcpCatalogTimeoutMs({ XIAOK_MCP_CATALOG_TIMEOUT_MS: '7000' })).toBe(7000);
    expect(resolveMcpCatalogTimeoutMs({ XIAOK_MCP_CATALOG_TIMEOUT_MS: 'bad' })).toBe(DEFAULT_MCP_CATALOG_TIMEOUT_MS);
    expect(resolveMcpCatalogTimeoutMs({ XIAOK_MCP_CATALOG_TIMEOUT_MS: '0' })).toBe(DEFAULT_MCP_CATALOG_TIMEOUT_MS);

    expect(resolveMcpResourceTimeoutMs({})).toBe(DEFAULT_MCP_RESOURCE_TIMEOUT_MS);
    expect(resolveMcpResourceTimeoutMs({ XIAOK_MCP_RESOURCE_TIMEOUT_MS: '45000' })).toBe(45000);
    expect(resolveMcpResourceTimeoutMs({ XIAOK_MCP_RESOURCE_TIMEOUT_MS: '-1' })).toBe(DEFAULT_MCP_RESOURCE_TIMEOUT_MS);
  });

  it('returns a disabled connection result instead of throwing from tryConnect', async () => {
    const result = await tryConnect('broken', { type: 'unsupported' } as any);

    expect(result.status).toBe('disabled');
    if (result.status === 'disabled') {
      expect(result.serverName).toBe('broken');
      expect(result.error.message).toContain('Unsupported MCP transport type');
    }
  });

  it('uses the package version for MCP client identity', () => {
    expect(resolveMcpClientVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(resolveMcpClientVersion()).not.toBe('0.5.6');
  });

  it('normalizes python3 on Windows and honors explicit Python command override', () => {
    expect(resolveStdioCommand('python3', 'win32', {})).toBe('python');
    expect(resolveStdioCommand('python3', 'linux', {})).toBe('python3');
    expect(resolveStdioCommand('python3', 'win32', { XIAOK_PYTHON_CMD: 'C:\\runtime\\python.exe' }))
      .toBe('C:\\runtime\\python.exe');
    expect(resolveStdioCommand('node', 'win32', { XIAOK_PYTHON_CMD: 'C:\\runtime\\python.exe' })).toBe('node');
  });
});
