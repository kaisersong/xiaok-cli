import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadPlugins } from '../../../src/platform/plugins/loader.js';
import { resolveInstallPaths } from '../../../src/platform/plugins/install/source.js';
import { switchActivePluginPointer } from '../../../src/platform/plugins/install/active-pointer.js';

describe('plugin loader', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `xiaok-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('loads plugins in directory precedence order', async () => {
    const globalDir = join(root, 'global');
    const projectDir = join(root, 'project');
    mkdirSync(join(globalDir, 'shared'), { recursive: true });
    mkdirSync(join(projectDir, 'local'), { recursive: true });
    writeFileSync(join(globalDir, 'shared', 'plugin.json'), JSON.stringify({ name: 'shared', version: '1.0.0' }));
    writeFileSync(join(projectDir, 'local', 'plugin.json'), JSON.stringify({ name: 'local', version: '1.0.0' }));

    const loaded = await loadPlugins([globalDir, projectDir]);

    expect(loaded.map((plugin) => plugin.name)).toEqual(['shared', 'local']);
  });

  it('reports collisions instead of silently overriding core capabilities', async () => {
    const pluginDir = join(root, 'plugins');
    mkdirSync(join(pluginDir, 'acme'), { recursive: true });
    writeFileSync(join(pluginDir, 'acme', 'plugin.json'), JSON.stringify({
      name: 'acme',
      version: '1.0.0',
      commands: ['doctor'],
      lspServers: [{ name: 'ts', command: 'node lsp-server.js' }],
    }));

    const loaded = await loadPlugins([pluginDir], { builtinCommands: ['doctor', 'chat'] });

    expect(loaded[0].collisions).toEqual(['command:doctor']);
    expect(loaded[0].lspServers?.[0]?.name).toBe('ts');
  });

  it('skips plugins that declare a different platform', async () => {
    const pluginDir = join(root, 'plugins');
    mkdirSync(join(pluginDir, 'mac-only'), { recursive: true });
    mkdirSync(join(pluginDir, 'windows-only'), { recursive: true });
    writeFileSync(join(pluginDir, 'mac-only', 'plugin.json'), JSON.stringify({
      name: 'mac-only',
      version: '1.0.0',
      platforms: ['darwin'],
    }));
    writeFileSync(join(pluginDir, 'windows-only', 'plugin.json'), JSON.stringify({
      name: 'windows-only',
      version: '1.0.0',
      platforms: ['win32'],
    }));

    const loaded = await loadPlugins([pluginDir], { platform: 'win32' });

    expect(loaded.map((plugin) => plugin.name)).toEqual(['windows-only']);
  });

  async function seedManagedPlugin(pluginsDir: string, name: string, version: string): Promise<string> {
    const digest = (name.charCodeAt(0) % 10).toString().repeat(64);
    const paths = resolveInstallPaths(pluginsDir);
    const versionDir = join(paths.managedDir, name, digest);
    const pluginDir = join(versionDir, 'repo', 'plugins', name);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name, version }));
    await switchActivePluginPointer(paths, {
      name,
      version,
      digest,
      commit: 'c'.repeat(40),
      versionDir,
      pluginDir,
      registryUrl: 'https://example.com/registry-v2.json',
      probe: { status: 'verified', outcomes: [] },
    });
    return pluginDir;
  }

  it('loads managed plugins through their active pointer', async () => {
    const pluginsDir = join(root, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    const managedDir = await seedManagedPlugin(pluginsDir, 'managed-plugin', '3.1.4');

    const loaded = await loadPlugins([pluginsDir]);

    expect(loaded.map((plugin) => plugin.name)).toEqual(['managed-plugin']);
    expect(loaded[0].version).toBe('3.1.4');
    expect(loaded[0].rootDir).toBe(managedDir);
  });

  it('lets the managed pointer win over a same-named legacy directory', async () => {
    const pluginsDir = join(root, 'plugins');
    mkdirSync(join(pluginsDir, 'managed-plugin'), { recursive: true });
    writeFileSync(join(pluginsDir, 'managed-plugin', 'plugin.json'), JSON.stringify({
      name: 'managed-plugin',
      version: '0.0.1',
    }));
    const managedDir = await seedManagedPlugin(pluginsDir, 'managed-plugin', '3.1.4');

    const loaded = await loadPlugins([pluginsDir]);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].version).toBe('3.1.4');
    expect(loaded[0].rootDir).toBe(managedDir);
  });

  it('keeps bundled and legacy direct directories loadable next to managed plugins', async () => {
    const pluginsDir = join(root, 'plugins');
    mkdirSync(join(pluginsDir, 'bundled-plugin'), { recursive: true });
    writeFileSync(join(pluginsDir, 'bundled-plugin', 'plugin.json'), JSON.stringify({
      name: 'bundled-plugin',
      version: '1.0.0',
    }));
    await seedManagedPlugin(pluginsDir, 'managed-plugin', '3.1.4');

    const loaded = await loadPlugins([pluginsDir]);

    expect(loaded.map((plugin) => plugin.name).sort()).toEqual(['bundled-plugin', 'managed-plugin']);
  });

  it('never loads the managed, active, lock or runtime directories as plugins', async () => {
    const pluginsDir = join(root, 'plugins');
    await seedManagedPlugin(pluginsDir, 'managed-plugin', '3.1.4');
    const paths = resolveInstallPaths(pluginsDir);
    mkdirSync(paths.runtimesDir, { recursive: true });
    writeFileSync(join(paths.managedDir, 'plugin.json'), JSON.stringify({ name: 'sneaky', version: '1.0.0' }));
    writeFileSync(join(paths.runtimesDir, 'plugin.json'), JSON.stringify({ name: 'sneaky', version: '1.0.0' }));

    const loaded = await loadPlugins([pluginsDir]);

    expect(loaded.map((plugin) => plugin.name)).toEqual(['managed-plugin']);
  });

  it('skips a corrupt pointer instead of failing the whole load', async () => {
    const pluginsDir = join(root, 'plugins');
    await seedManagedPlugin(pluginsDir, 'managed-plugin', '3.1.4');
    const paths = resolveInstallPaths(pluginsDir);
    writeFileSync(join(paths.activeDir, 'broken.json'), '{oops', 'utf8');

    const loaded = await loadPlugins([pluginsDir]);

    expect(loaded.map((plugin) => plugin.name)).toEqual(['managed-plugin']);
  });

  it('does not fall back to a same-named legacy directory when its managed pointer is corrupt', async () => {
    const pluginsDir = join(root, 'plugins');
    const paths = resolveInstallPaths(pluginsDir);
    mkdirSync(paths.activeDir, { recursive: true });
    mkdirSync(join(pluginsDir, 'managed-plugin'), { recursive: true });
    writeFileSync(join(paths.activeDir, 'managed-plugin.json'), '{oops', 'utf8');
    writeFileSync(join(pluginsDir, 'managed-plugin', 'plugin.json'), JSON.stringify({
      name: 'managed-plugin',
      version: '0.0.1',
    }));

    const loaded = await loadPlugins([pluginsDir]);

    expect(loaded).toEqual([]);
  });

  it('keeps loading verified managed plugins when an unrelated legacy manifest is malformed', async () => {
    const pluginsDir = join(root, 'plugins');
    await seedManagedPlugin(pluginsDir, 'managed-plugin', '3.1.4');
    mkdirSync(join(pluginsDir, 'broken-legacy'), { recursive: true });
    writeFileSync(join(pluginsDir, 'broken-legacy', 'plugin.json'), '{oops', 'utf8');

    const loaded = await loadPlugins([pluginsDir]);

    expect(loaded.map((plugin) => plugin.name)).toEqual(['managed-plugin']);
  });

  it('uses an invalid pointer filename basename to block same-named legacy fallback', async () => {
    const pluginsDir = join(root, 'plugins');
    const paths = resolveInstallPaths(pluginsDir);
    mkdirSync(paths.activeDir, { recursive: true });
    mkdirSync(join(pluginsDir, 'Legacy'), { recursive: true });
    writeFileSync(join(paths.activeDir, 'Legacy.json'), '{oops', 'utf8');
    writeFileSync(join(pluginsDir, 'Legacy', 'plugin.json'), JSON.stringify({ name: 'Legacy', version: '0.0.1' }));

    const loaded = await loadPlugins([pluginsDir]);

    expect(loaded).toEqual([]);
  });

  it('rewrites managed python MCP declarations to the persisted isolated runtime', async () => {
    const pluginsDir = join(root, 'plugins');
    const paths = resolveInstallPaths(pluginsDir);
    const digest = '7'.repeat(64);
    const versionDir = join(paths.managedDir, 'python-plugin', digest);
    const pluginDir = join(versionDir, 'repo', 'plugins', 'python-plugin');
    const pythonRuntimeDir = join(paths.runtimesDir, 'python-plugin', digest);
    mkdirSync(pluginDir, { recursive: true });
    mkdirSync(pythonRuntimeDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'python-plugin',
      version: '1.0.0',
      mcpServers: [{ name: 'renderer', type: 'stdio', command: 'python3', args: ['server.py'] }],
    }));
    await switchActivePluginPointer(paths, {
      name: 'python-plugin',
      version: '1.0.0',
      digest,
      commit: 'c'.repeat(40),
      versionDir,
      pluginDir,
      pythonRuntimeDir,
      registryUrl: 'https://example.com/registry-v2.json',
      probe: { status: 'verified', outcomes: [] },
    });

    const loaded = await loadPlugins([pluginsDir], { platform: 'linux' });

    expect(loaded[0].mcpServers?.[0]?.command).toBe(join(pythonRuntimeDir, 'bin', 'python'));
  });
});
