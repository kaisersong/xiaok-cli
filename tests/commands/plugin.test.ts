import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

describe('plugin commands', () => {
  let testDir: string;
  let pluginsDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalHome: string | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-plugin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    // Clear module cache so next test gets fresh HOME
    Object.keys(require.cache || {}).forEach((key) => {
      if (key.includes('plugin.js')) delete require.cache[key];
    });
    rmSync(testDir, { recursive: true, force: true });
  });

  async function getPluginModule() {
    return import(pathToFileURL(join(process.cwd(), 'dist', 'commands', 'plugin.js')).href);
  }

  describe('plugin list', () => {
    it('reports no plugins when directory is empty', async () => {
      const mod = await getPluginModule();
      mod.runList();

      const logCalls = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logCalls).toMatch(/No plugins installed/i);
    });

    it('lists plugins with valid plugin.json', async () => {
      const pluginDir = join(pluginsDir, 'test-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
        name: 'test-plugin',
        version: '1.0.0',
        interface: {
          display_name: '测试插件',
          short_description: '这是一个测试插件',
        },
        skills: [],
        hooks: [],
        commands: [],
        mcpServers: [],
      }));

      const mod = await getPluginModule();
      mod.runList();

      const logCalls = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logCalls).toContain('test-plugin');
      expect(logCalls).toContain('测试插件');
    });

    it('skips directories without plugin.json', async () => {
      const junkDir = join(pluginsDir, 'junk');
      mkdirSync(junkDir, { recursive: true });
      writeFileSync(join(junkDir, 'README.md'), 'not a plugin');

      const mod = await getPluginModule();
      mod.runList();

      const logCalls = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logCalls).toMatch(/No plugins installed/i);
    });

    it('handles invalid plugin.json gracefully', async () => {
      const pluginDir = join(pluginsDir, 'broken');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'plugin.json'), 'not valid json');

      const mod = await getPluginModule();
      mod.runList();

      const logCalls = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logCalls).toContain('broken');
      expect(logCalls).toContain('invalid manifest');
    });
  });

  describe('plugin uninstall', () => {
    it('removes an installed plugin', async () => {
      const pluginDir = join(pluginsDir, 'test-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
        name: 'test-plugin',
        version: '1.0.0',
        skills: [],
        hooks: [],
        commands: [],
        mcpServers: [],
      }));

      expect(existsSync(pluginDir)).toBe(true);

      const mod = await getPluginModule();
      mod.runUninstall('test-plugin');

      expect(existsSync(pluginDir)).toBe(false);
    });

    it('does not remove non-existent plugin dir', async () => {
      const mod = await getPluginModule();
      expect(() => {
        mod.runUninstall('nonexistent');
      }).toThrow(/not installed|process.exit/);
    });
  });
});
