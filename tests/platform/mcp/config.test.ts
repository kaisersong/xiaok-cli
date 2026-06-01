import { describe, expect, it } from 'vitest';
import {
  loadPluginMcpServers,
  mergeMcpServerConfigs,
} from '../../../src/platform/mcp/config.js';
import type { PlatformPluginRuntimeState } from '../../../src/platform/plugins/runtime.js';

function fakePluginRuntime(plugins: Array<{
  name: string;
  rootDir: string;
  mcpServers?: Array<{ name: string; type: 'stdio'; command: string; requiresUserActivation?: boolean }>;
}>): PlatformPluginRuntimeState {
  return {
    plugins: plugins.map((p) => ({
      name: p.name,
      version: '1.0.0',
      skills: [],
      agents: [],
      hooks: [],
      commands: [],
      mcpServers: p.mcpServers,
      lspServers: undefined,
      rootDir: p.rootDir,
      collisions: [],
    })) as unknown as PlatformPluginRuntimeState['plugins'],
    skillRoots: [],
    agentDirs: [],
    hookConfigs: [],
    hookCommands: [],
    commandDeclarations: [],
    mcpServers: plugins.flatMap((p) => p.mcpServers ?? []),
    lspServers: [],
  };
}

describe('loadPluginMcpServers', () => {
  it('attaches plugin source metadata (origin, pluginName, pluginDir) to each server', () => {
    const runtime = fakePluginRuntime([
      {
        name: 'cua-computer-use',
        rootDir: '/plugins/cua-computer-use',
        mcpServers: [{ name: 'cua-driver', type: 'stdio', command: 'cua-driver' }],
      },
      {
        name: 'docs-plugin',
        rootDir: '/plugins/docs',
        mcpServers: [{ name: 'docs', type: 'stdio', command: 'docs' }],
      },
    ]);
    const servers = loadPluginMcpServers(runtime);
    expect(servers).toHaveLength(2);
    expect(servers[0].source).toEqual({
      origin: 'plugin',
      pluginName: 'cua-computer-use',
      pluginDir: '/plugins/cua-computer-use',
    });
    expect(servers[1].source).toEqual({
      origin: 'plugin',
      pluginName: 'docs-plugin',
      pluginDir: '/plugins/docs',
    });
  });

  it('preserves requiresUserActivation when set on the plugin manifest server', () => {
    const runtime = fakePluginRuntime([
      {
        name: 'cua-computer-use',
        rootDir: '/plugins/cua-computer-use',
        mcpServers: [{ name: 'cua-driver', type: 'stdio', command: 'cua-driver', requiresUserActivation: true }],
      },
    ]);
    const servers = loadPluginMcpServers(runtime);
    expect(servers[0].requiresUserActivation).toBe(true);
    expect(servers[0].source?.pluginName).toBe('cua-computer-use');
  });
});

describe('mergeMcpServerConfigs', () => {
  it('returns servers with settings origin source for entries from settings.json', () => {
    const result = mergeMcpServerConfigs(
      { docs: { type: 'stdio', command: 'd' } },
      [],
    );
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].source).toEqual({ origin: 'settings' });
    expect(result.conflicts).toEqual([]);
  });

  it('records a conflict when a plugin server overrides a settings entry of the same name', () => {
    const pluginServer = {
      name: 'docs',
      type: 'stdio' as const,
      command: 'plugin-docs',
      source: { origin: 'plugin' as const, pluginName: 'docs-plugin', pluginDir: '/plugins/docs' },
    };
    const result = mergeMcpServerConfigs(
      { docs: { type: 'stdio', command: 'settings-docs' } },
      [pluginServer],
    );
    // winner is the plugin server (current behavior preserved)
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].source).toEqual(pluginServer.source);
    expect(result.conflicts).toEqual([
      {
        name: 'docs',
        winner: pluginServer.source,
        loser: { origin: 'settings' },
      },
    ]);
  });

  it('records a conflict when two plugins declare the same server name', () => {
    const a = {
      name: 'docs',
      type: 'stdio' as const,
      command: 'a',
      source: { origin: 'plugin' as const, pluginName: 'plugin-a', pluginDir: '/a' },
    };
    const b = {
      name: 'docs',
      type: 'stdio' as const,
      command: 'b',
      source: { origin: 'plugin' as const, pluginName: 'plugin-b', pluginDir: '/b' },
    };
    const result = mergeMcpServerConfigs({}, [a, b]);
    expect(result.servers).toHaveLength(1);
    // Last writer wins (preserves prior behavior); conflict logged
    expect(result.servers[0].source).toEqual(b.source);
    expect(result.conflicts).toEqual([
      {
        name: 'docs',
        winner: b.source,
        loser: a.source,
      },
    ]);
  });

  it('does not report conflicts when names are distinct', () => {
    const result = mergeMcpServerConfigs(
      { a: { type: 'stdio', command: 'a' } },
      [
        {
          name: 'b',
          type: 'stdio',
          command: 'b',
          source: { origin: 'plugin', pluginName: 'pb', pluginDir: '/pb' },
        },
      ],
    );
    expect(result.conflicts).toEqual([]);
    expect(result.servers).toHaveLength(2);
  });
});
