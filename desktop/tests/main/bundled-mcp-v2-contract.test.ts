import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isPackaged: true } }));
import { deployBundledPluginFiles } from '../../electron/deploy-bundled-plugins.js';

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

// A compatibility contract, not a copy of the deployer's upgrade algorithm.
// New major versions (or minor versions before 1.0) require explicit review.
function compatibleStableVersion(actual: unknown, floor: string): boolean {
  if (typeof actual !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(actual)) return false;
  const parts = actual.split('.').map(Number), minimum = floor.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger) || parts[0] !== minimum[0] || (parts[0] === 0 && parts[1] !== minimum[1])) return false;
  return parts[1] > minimum[1] || (parts[1] === minimum[1] && parts[2] >= minimum[2]);
}

describe('Desktop bundled MCP v2 contract', () => {
  it('declares the official MCP client as a packaged Desktop runtime dependency', () => {
    const desktopPackage = JSON.parse(readFileSync(
      join(XIAOK_ROOT, 'desktop', 'package.json'),
      'utf8',
    )) as { dependencies?: Record<string, string> };

    expect(desktopPackage.dependencies?.['@modelcontextprotocol/client']).toBe('2.3.0');
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
    expect(compatibleStableVersion(readPluginManifest('kai-report-creator').version, '2.4.0')).toBe(true);
    expect(compatibleStableVersion(readPluginManifest('kai-slide-creator').version, '3.4.0')).toBe(true);
    expect(compatibleStableVersion(readPluginManifest('cua-computer-use').version, '0.3.1')).toBe(true);
  });

  it.each(['2.3.99', '2.4.0-rc.1', '2.4.0garbage', '2.04.0', '3.0.0', undefined])('rejects an unreviewed or older renderer version %s', version => {
    expect(compatibleStableVersion(version, '2.4.0')).toBe(false);
  });
  it('accepts numerical minor upgrades without accepting a pre-1.0 compatibility break', () => {
    expect(compatibleStableVersion('2.10.0', '2.4.0')).toBe(true);
    expect(compatibleStableVersion('0.4.0', '0.3.1')).toBe(false);
  });
  it('the actual deployer replaces old copies and preserves newer user-managed versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'bundled-mcp-upgrade-'));
    const originalConfig = process.env.XIAOK_CONFIG_DIR;
    const originalResources = process.resourcesPath;
    try {
      process.env.XIAOK_CONFIG_DIR = join(root, 'config');
      process.resourcesPath = root;
      for (const [name, previous] of [['kai-report-creator', '2.3.0'], ['kai-slide-creator', '3.3.0']] as const) {
        const source = join(root, 'bundled-plugins', name), target = join(root, 'config', 'plugins', name);
        mkdirSync(source, { recursive: true }); mkdirSync(target, { recursive: true });
        writeFileSync(join(source, 'plugin.json'), JSON.stringify(readPluginManifest(name)));
        writeFileSync(join(target, 'plugin.json'), JSON.stringify({ name, version: previous, source: 'bundled' }));
      }
      expect(deployBundledPluginFiles().deployed).toEqual(['kai-report-creator', 'kai-slide-creator']);
      for (const name of ['kai-report-creator', 'kai-slide-creator']) {
        const target = join(root, 'config', 'plugins', name, 'plugin.json');
        expect(JSON.parse(readFileSync(target, 'utf8')).version).toBe(readPluginManifest(name).version);
        writeFileSync(target, JSON.stringify({ name, version: '99.0.0', source: 'user' }));
      }
      expect(deployBundledPluginFiles().deployed).toEqual([]);
      for (const name of ['kai-report-creator', 'kai-slide-creator']) expect(JSON.parse(readFileSync(join(root, 'config', 'plugins', name, 'plugin.json'), 'utf8')).version).toBe('99.0.0');
    } finally {
      if (originalConfig === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = originalConfig;
      if (originalResources === undefined) delete (process as Partial<NodeJS.Process>).resourcesPath; else process.resourcesPath = originalResources;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
