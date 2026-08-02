import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { switchActivePluginPointer } from '../../src/platform/plugins/install/active-pointer.js';
import { resolveInstallPaths } from '../../src/platform/plugins/install/source.js';
import { runInstall, runList, runUninstall } from '../../src/commands/plugin.js';

describe('plugin commands', () => {
  let testDir: string;
  let pluginsDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalHome: string | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'xiaok-plugin-test-'));
    pluginsDir = join(testDir, '.xiaok', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = testDir;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    rmSync(testDir, { recursive: true, force: true });
  });

  function logged(): string {
    return consoleLogSpy.mock.calls.map((call) => String(call[0])).join('\n');
  }

  async function seedManaged(name: string, version: string, probeStatus: 'verified' | 'unverified' = 'verified') {
    const digest = 'a'.repeat(64);
    const paths = resolveInstallPaths(pluginsDir);
    const versionDir = join(paths.managedDir, name, digest);
    const pluginDir = join(versionDir, 'repo', 'plugins', name);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name,
      version,
      interface: { display_name: '受管插件', short_description: '通过 registry v2 安装' },
    }));
    await switchActivePluginPointer(paths, {
      name,
      version,
      digest,
      commit: 'c'.repeat(40),
      versionDir,
      pluginDir,
      registryUrl: 'https://example.com/registry-v2.json',
      probe: { status: probeStatus, outcomes: [] },
    });
    return { paths, versionDir, pluginDir, digest };
  }

  describe('plugin list', () => {
    it('reports no plugins when directory is empty', () => {
      runList();

      expect(logged()).toMatch(/No plugins installed/i);
    });

    it('lists plugins with valid plugin.json', () => {
      const pluginDir = join(pluginsDir, 'test-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
        name: 'test-plugin',
        version: '1.0.0',
        interface: {
          display_name: '测试插件',
          short_description: '这是一个测试插件',
        },
      }));

      runList();

      expect(logged()).toContain('test-plugin');
      expect(logged()).toContain('测试插件');
    });

    it('skips directories without plugin.json', () => {
      mkdirSync(join(pluginsDir, 'junk'), { recursive: true });
      writeFileSync(join(pluginsDir, 'junk', 'README.md'), 'not a plugin');

      runList();

      expect(logged()).toMatch(/No plugins installed/i);
    });

    it('handles invalid plugin.json gracefully', () => {
      const pluginDir = join(pluginsDir, 'broken');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'plugin.json'), 'not valid json');

      runList();

      expect(logged()).toContain('broken');
      expect(logged()).toContain('invalid manifest');
    });

    it('lists managed plugins from the active pointer with their verification state', async () => {
      await seedManaged('managed-plugin', '2.1.0', 'unverified');

      runList();

      const output = logged();
      expect(output).toContain('managed-plugin');
      expect(output).toContain('2.1.0');
      expect(output).toContain('受管插件');
      expect(output).toMatch(/unverified/i);
      expect(output).not.toMatch(/已验证可用/);
    });

    it('reports invalid pointers instead of hiding them', async () => {
      const { paths } = await seedManaged('managed-plugin', '2.1.0');
      writeFileSync(join(paths.activeDir, 'ghost.json'), '{oops', 'utf8');

      runList();

      expect(logged()).toMatch(/ghost/);
      expect(logged()).toMatch(/invalid pointer/i);
    });

    it('never lists internal install directories as plugins', async () => {
      await seedManaged('managed-plugin', '2.1.0');

      runList();

      expect(logged()).not.toContain('.managed');
      expect(logged()).not.toContain('.active');
    });
  });

  describe('plugin uninstall', () => {
    it('removes a legacy directory install', () => {
      const pluginDir = join(pluginsDir, 'test-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'test-plugin', version: '1.0.0' }));

      runUninstall('test-plugin');

      expect(existsSync(pluginDir)).toBe(false);
    });

    it('removes the active pointer and every managed version', async () => {
      const { paths, versionDir } = await seedManaged('managed-plugin', '2.1.0');
      const runtimeDir = join(paths.runtimesDir, 'managed-plugin');
      mkdirSync(runtimeDir, { recursive: true });

      runUninstall('managed-plugin');

      expect(existsSync(join(paths.activeDir, 'managed-plugin.json'))).toBe(false);
      expect(existsSync(versionDir)).toBe(false);
      expect(existsSync(join(paths.managedDir, 'managed-plugin'))).toBe(false);
      expect(existsSync(runtimeDir)).toBe(false);
    });

    it('throws for a plugin that is not installed', () => {
      expect(() => runUninstall('nonexistent')).toThrow(/not installed/i);
    });

    it('rejects path traversal without deleting a plugin-shaped directory outside the plugins root', () => {
      const victimDir = join(testDir, 'victim');
      mkdirSync(victimDir, { recursive: true });
      writeFileSync(join(victimDir, 'plugin.json'), JSON.stringify({ name: 'victim', version: '1.0.0' }));

      expect(() => runUninstall('../../victim')).toThrow(/invalid plugin name/i);

      expect(existsSync(victimDir)).toBe(true);
    });
  });

  describe('plugin install', () => {
    it('refuses a custom registry without --trust-registry', async () => {
      await expect(runInstall('demo-plugin', { registry: 'https://example.com/registry-v2.json' }))
        .rejects.toThrow(/--trust-registry/);
    });
  });
});
