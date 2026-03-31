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
});
