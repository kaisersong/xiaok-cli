import { Client } from '@modelcontextprotocol/client';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  createMcpClientConnection,
  createMcpClientOptions,
  createMcpSdkClient,
  InPlaceStdioClientTransport,
  waitForProcessExit,
  tryConnect,
} from '../../../src/platform/mcp/transport.js';

describe('MCP transport helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
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

  it('creates an SDK v2 client with automatic modern-to-legacy negotiation', () => {
    const client = createMcpSdkClient();

    expect(client.getProtocolEra()).toBeUndefined();
    expect(createMcpClientOptions()).toMatchObject({
      capabilities: {},
      versionNegotiation: {
        mode: 'auto',
        probe: {
          timeoutMs: DEFAULT_MCP_STARTUP_TIMEOUT_MS,
          maxRetries: 0,
        },
      },
    });
    expect(createMcpClientOptions(12_345)).toMatchObject({
      versionNegotiation: {
        probe: {
          timeoutMs: 12_345,
        },
      },
    });
  });

  it('maps explicit legacy and modern protocol policies to SDK v2 negotiation', () => {
    expect(createMcpClientOptions(3_000, { mode: 'legacy' })).toMatchObject({
      versionNegotiation: {
        mode: 'legacy',
      },
    });
    expect(createMcpClientOptions(3_000, {
      mode: 'modern',
      version: '2026-07-28',
    })).toMatchObject({
      versionNegotiation: {
        mode: { pin: '2026-07-28' },
      },
    });
  });

  it('keeps the in-place stdio transport subclass compatible with the SDK probe canary', () => {
    expect(Object.prototype.hasOwnProperty.call(
      InPlaceStdioClientTransport.prototype,
      '_dispose',
    )).toBe(false);
  });

  it('normalizes python3 on Windows and honors explicit Python command override', () => {
    expect(resolveStdioCommand('python3', 'win32', {})).toBe('python');
    expect(resolveStdioCommand('python3', 'linux', {})).toBe('python3');
    expect(resolveStdioCommand('python3', 'win32', { XIAOK_PYTHON_CMD: 'C:\\runtime\\python.exe' }))
      .toBe('C:\\runtime\\python.exe');
    expect(resolveStdioCommand('node', 'win32', { XIAOK_PYTHON_CMD: 'C:\\runtime\\python.exe' })).toBe('node');
  });

  it('exposes an awaitable close that resolves only after the stdio child exits', async () => {
    const connection = await createMcpClientConnection('legacy-stdio', {
      type: 'stdio',
      command: process.execPath,
      args: [join(process.cwd(), 'tests', 'support', 'mcp-stdio-server.js')],
      protocol: { mode: 'legacy' },
      timeout: { startup: 10_000 },
    });

    const pid = connection.getChildPid();
    expect(typeof pid).toBe('number');
    expect(() => process.kill(pid as number, 0)).not.toThrow();

    await connection.close();

    expect(() => process.kill(pid as number, 0)).toThrow();
    // Repeated closes stay safe for callers that also register dispose().
    await connection.close();
    connection.dispose();
  });

  it('force-kills a stdio child that does not exit before the close deadline', async () => {
    const signals: Array<NodeJS.Signals | 0 | undefined> = [];
    let killed = false;
    const killProcess = (_pid: number, signal?: NodeJS.Signals | 0) => {
      signals.push(signal);
      if (signal === 'SIGKILL') killed = true;
      if (signal === 0 && killed) {
        const error = new Error('gone') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }
      return true;
    };

    await expect(waitForProcessExit(12345, 0, killProcess)).resolves.toBeUndefined();

    expect(signals).toContain('SIGKILL');
  });

  it('force-kills the stdio child when connect finishes without a negotiated protocol era', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-mcp-no-era-'));
    const pidFile = join(root, 'pid');
    vi.spyOn(Client.prototype, 'getProtocolEra').mockReturnValue(undefined);

    let childPid: number | null = null;
    try {
      await expect(createMcpClientConnection('no-era-stdio', {
        type: 'stdio',
        command: process.execPath,
        args: [join(process.cwd(), 'tests', 'support', 'mcp-stdio-server.js')],
        env: {
          ...process.env,
          XIAOK_TEST_MCP_PID_FILE: pidFile,
          XIAOK_TEST_MCP_STUBBORN: '1',
        },
        protocol: { mode: 'legacy' },
        timeout: { startup: 10_000 },
      })).rejects.toThrow(/negotiated protocol era/i);

      expect(existsSync(pidFile)).toBe(true);
      childPid = Number(readFileSync(pidFile, 'utf8'));
      expect(() => process.kill(childPid as number, 0)).toThrow();
    } finally {
      if (childPid !== null) {
        try { process.kill(childPid, 'SIGKILL'); } catch {}
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});
