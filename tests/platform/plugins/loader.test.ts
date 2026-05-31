import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadPlugins } from '../../../src/platform/plugins/loader.js';

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
});
