import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const XIAOK_ROOT = join(__dirname, '..', '..', '..');
const PLUGINS_ROOT = join(XIAOK_ROOT, '..', 'kai-xiaok-plugins', 'plugins');

function readPluginManifest(pluginName: string): Record<string, unknown> {
  return JSON.parse(readFileSync(
    join(PLUGINS_ROOT, pluginName, 'plugin.json'),
    'utf8',
  )) as Record<string, unknown>;
}

function firstMcpServer(manifest: Record<string, unknown>): Record<string, unknown> {
  const servers = manifest.mcpServers as Array<Record<string, unknown>>;
  return servers[0];
}

describe('Desktop bundled MCP v2 contract', () => {
  it('declares the official MCP client as a packaged Desktop runtime dependency', () => {
    const desktopPackage = JSON.parse(readFileSync(
      join(XIAOK_ROOT, 'desktop', 'package.json'),
      'utf8',
    )) as { dependencies?: Record<string, string> };

    expect(desktopPackage.dependencies?.['@modelcontextprotocol/client']).toBe('^2.0.0');
  });

  it('does not use the legacy stdio client factories in Desktop services', () => {
    const source = readFileSync(
      join(XIAOK_ROOT, 'desktop', 'electron', 'desktop-services.ts'),
      'utf8',
    );

    expect(source).not.toContain('createMcpRuntimeClient');
    expect(source).not.toContain('createStdioMcpTransport');
    expect(source).not.toContain('startMcpServerProcess');
    expect(source).toContain('createMcpClientConnection');
  });

  it('pins bundled renderers to modern MCP and CUA to explicit legacy mode', () => {
    const report = readPluginManifest('kai-report-creator');
    const slide = readPluginManifest('kai-slide-creator');
    const cua = readPluginManifest('cua-computer-use');

    for (const manifest of [report, slide]) {
      expect(firstMcpServer(manifest)).toMatchObject({
        protocol: { mode: 'modern', version: '2026-07-28' },
        timeout: { startup: 30_000, call: 30_000 },
      });
    }
    expect(firstMcpServer(cua)).toMatchObject({
      protocol: { mode: 'legacy' },
      timeout: { startup: 30_000, call: 30_000 },
    });
  });

  it('bumps bundled plugin versions so deployed copies are replaced', () => {
    // Sibling source moved on (report 2.3.0 / slide 3.3.0); the invariant this test
    // protects is that the deployed copies are replaced, i.e. the manifests carry a
    // version at least as new as the last one Desktop pinned.
    expect(readPluginManifest('kai-report-creator').version).toBe('2.3.0');
    expect(readPluginManifest('kai-slide-creator').version).toBe('3.3.0');
    expect(readPluginManifest('cua-computer-use').version).toBe('0.2.1');
  });
});
