import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTrustedRegistry, type TrustedRegistryPlugin } from '../../../src/platform/plugins/install/registry.js';
import {
  probePluginMcpServers,
  validateCandidatePlugin,
} from '../../../src/platform/plugins/install/probe.js';

const LEGACY_SERVER = `
const fs = require('node:fs');
fs.writeFileSync(process.env.PROBE_REPORT, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\\n');
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\\n');
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'legacy-fixture', version: '1.0.0' },
        },
      }) + '\\n');
      continue;
    }
    if (message.method === 'tools/list') {
      if (process.env.PROBE_TOOLS_FAIL === '1') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: 'catalog unavailable' },
        }) + '\\n');
        continue;
      }
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: { tools: [{ name: 'render', description: 'render', inputSchema: { type: 'object' } }] },
      }) + '\\n');
      continue;
    }
    if (message.id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\\n');
    }
  }
});
`;

const MODERN_SERVER = `
import { writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
writeFileSync(process.env.PROBE_REPORT, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
const server = new McpServer({ name: 'modern-fixture', version: '1.0.0' });
server.registerTool('ping', { description: 'ping', inputSchema: {} }, async () => ({
  content: [{ type: 'text', text: 'pong' }],
}));
await serveStdio(() => server);
`;

function registryEntry(overrides: Partial<{ name: string; version: string }> = {}): TrustedRegistryPlugin {
  return parseTrustedRegistry({
    version: 2,
    plugins: [
      {
        name: overrides.name ?? 'demo-plugin',
        repo: 'kaisersong/kai-xiaok-plugins',
        path: 'plugins/demo-plugin',
        version: overrides.version ?? '1.0.0',
        source: { commit: 'a'.repeat(40), treeSha256: 'b'.repeat(64) },
      },
    ],
  }).plugins[0];
}

describe('candidate plugin validation', () => {
  let pluginDir: string;

  beforeEach(() => {
    pluginDir = mkdtempSync(join(tmpdir(), 'xiaok-probe-validate-'));
  });

  afterEach(() => {
    rmSync(pluginDir, { recursive: true, force: true });
  });

  function writeManifest(manifest: Record<string, unknown>): void {
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest), 'utf8');
  }

  it('accepts a manifest that matches the registry entry', () => {
    writeManifest({ name: 'demo-plugin', version: '1.0.0', platforms: ['darwin', 'win32', 'linux'] });

    const manifest = validateCandidatePlugin(registryEntry(), pluginDir);

    expect(manifest.name).toBe('demo-plugin');
    expect(manifest.version).toBe('1.0.0');
  });

  it('rejects a manifest whose name or version disagrees with the registry', () => {
    writeManifest({ name: 'other-plugin', version: '1.0.0' });
    expect(() => validateCandidatePlugin(registryEntry(), pluginDir)).toThrow(/name/i);

    writeManifest({ name: 'demo-plugin', version: '2.0.0' });
    expect(() => validateCandidatePlugin(registryEntry(), pluginDir)).toThrow(/version/i);
  });

  it('rejects a missing or malformed plugin.json', () => {
    expect(() => validateCandidatePlugin(registryEntry(), pluginDir)).toThrow(/plugin\.json/);

    writeFileSync(join(pluginDir, 'plugin.json'), '{not json', 'utf8');
    expect(() => validateCandidatePlugin(registryEntry(), pluginDir)).toThrow(/plugin\.json/);
  });

  it('rejects an unsupported MCP declaration before anything is activated', () => {
    writeManifest({
      name: 'demo-plugin',
      version: '1.0.0',
      mcpServers: [{ name: 'broken', type: 'stdio', command: 'node', protocol: { mode: 'modern', version: 'nope' } }],
    });

    expect(() => validateCandidatePlugin(registryEntry(), pluginDir)).toThrow(/protocol/i);
  });
});

describe('candidate MCP probe', () => {
  let root: string;
  let pluginDir: string;
  let reportPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-probe-'));
    pluginDir = join(root, 'plugin');
    mkdirSync(join(pluginDir, 'mcp-servers'), { recursive: true });
    reportPath = join(root, 'probe-report.json');
    writeFileSync(join(pluginDir, 'mcp-servers', 'legacy-server.cjs'), LEGACY_SERVER, 'utf8');
    writeFileSync(join(pluginDir, 'mcp-servers', 'modern-server.mjs'), MODERN_SERVER, 'utf8');
    // The modern fixture imports the real MCP server SDK.
    symlinkSync(join(process.cwd(), 'node_modules'), join(pluginDir, 'node_modules'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function manifestWith(servers: Array<Record<string, unknown>>, extras: Record<string, unknown> = {}) {
    const manifest = { name: 'demo-plugin', version: '1.0.0', mcpServers: servers, ...extras };
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest), 'utf8');
    return validateCandidatePlugin(registryEntry(), pluginDir);
  }

  it('completes initialize and tools/list against a legacy stdio server in the candidate dir', async () => {
    const manifest = manifestWith([{
      name: 'legacy-renderer',
      type: 'stdio',
      command: process.execPath,
      args: ['mcp-servers/legacy-server.cjs'],
      protocol: { mode: 'legacy' },
      env: { PROBE_REPORT: reportPath },
    }]);

    const result = await probePluginMcpServers({ pluginDir, manifest });

    expect(result.status).toBe('verified');
    expect(result.outcomes).toEqual([
      expect.objectContaining({ serverName: 'legacy-renderer', status: 'connected', protocolEra: 'legacy', toolCount: 1 }),
    ]);

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { pid: number; cwd: string };
    expect(existsSync(reportPath)).toBe(true);
    expect(report.cwd).toBe(realpathSync(pluginDir));
    // The pointer may only be written once the probed child is gone.
    expect(() => process.kill(report.pid, 0)).toThrow();
  });

  it('completes the probe against a modern stdio server', async () => {
    const manifest = manifestWith([{
      name: 'modern-renderer',
      type: 'stdio',
      command: process.execPath,
      args: ['mcp-servers/modern-server.mjs'],
      protocol: { mode: 'modern', version: '2026-07-28' },
      env: { PROBE_REPORT: reportPath },
    }]);

    const result = await probePluginMcpServers({ pluginDir, manifest });

    expect(result.status).toBe('verified');
    expect(result.outcomes[0]).toMatchObject({
      serverName: 'modern-renderer',
      status: 'connected',
      protocolEra: 'modern',
      toolCount: 1,
    });
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { pid: number };
    expect(() => process.kill(report.pid, 0)).toThrow();
  });

  it('fails closed when tools/list fails', async () => {
    const manifest = manifestWith([{
      name: 'legacy-renderer',
      type: 'stdio',
      command: process.execPath,
      args: ['mcp-servers/legacy-server.cjs'],
      protocol: { mode: 'legacy' },
      env: { PROBE_REPORT: reportPath, PROBE_TOOLS_FAIL: '1' },
    }]);

    await expect(probePluginMcpServers({ pluginDir, manifest })).rejects.toThrow(/legacy-renderer/);
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { pid: number };
    expect(() => process.kill(report.pid, 0)).toThrow();
  });

  it('fails closed when the server cannot start', async () => {
    const manifest = manifestWith([{
      name: 'missing-server',
      type: 'stdio',
      command: process.execPath,
      args: ['mcp-servers/does-not-exist.cjs'],
      protocol: { mode: 'legacy' },
      timeout: { startup: 3_000 },
    }]);

    await expect(probePluginMcpServers({ pluginDir, manifest })).rejects.toThrow(/missing-server/);
  });

  it('skips servers that require user activation, are platform-gated, or need external setup', async () => {
    const manifest = manifestWith([
      {
        name: 'needs-activation',
        type: 'stdio',
        command: process.execPath,
        args: ['mcp-servers/legacy-server.cjs'],
        requiresUserActivation: true,
      },
      {
        name: 'needs-system-python',
        type: 'stdio',
        command: 'python3',
        args: ['mcp-servers/slide.py'],
      },
    ]);

    const result = await probePluginMcpServers({
      pluginDir,
      manifest,
      skipServerNames: ['needs-system-python'],
    });

    expect(result.status).toBe('unverified');
    expect(result.outcomes).toEqual([
      expect.objectContaining({ serverName: 'needs-activation', status: 'skipped', reason: 'requiresUserActivation' }),
      expect.objectContaining({ serverName: 'needs-system-python', status: 'skipped', reason: 'externalDependency' }),
    ]);
  });

  it('skips every server when the plugin does not support the current platform', async () => {
    const manifest = manifestWith(
      [{
        name: 'legacy-renderer',
        type: 'stdio',
        command: process.execPath,
        args: ['mcp-servers/legacy-server.cjs'],
        protocol: { mode: 'legacy' },
        env: { PROBE_REPORT: reportPath },
      }],
      { platforms: ['win32'] },
    );

    const result = await probePluginMcpServers({ pluginDir, manifest, platform: 'darwin' });

    expect(result.status).toBe('unverified');
    expect(result.outcomes[0]).toMatchObject({ status: 'skipped', reason: 'unsupportedPlatform' });
    expect(existsSync(reportPath)).toBe(false);
  });

  it('reports unverified when a plugin declares no MCP servers', async () => {
    const manifest = manifestWith([]);

    const result = await probePluginMcpServers({ pluginDir, manifest });

    expect(result).toEqual({ status: 'unverified', outcomes: [] });
  });
});
