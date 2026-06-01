import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePluginManifest } from '../../../src/platform/plugins/manifest.js';

describe('plugin manifest', () => {
  it('parses plugin manifest with skills agents hooks and commands', () => {
    const manifest = parsePluginManifest({
      name: 'acme-tools',
      version: '1.0.0',
      platforms: ['darwin'],
      skills: ['skills/review.md'],
      agents: ['agents/reviewer.md'],
      hooks: ['hooks/pre.js'],
      commands: ['doctor'],
      mcpServers: [{ name: 'docs', type: 'stdio', command: 'node docs-server.js' }],
      lspServers: [{ name: 'ts', command: 'node lsp-server.js' }],
    }, '/plugins/acme');

    expect(manifest.name).toBe('acme-tools');
    expect(manifest.platforms).toEqual(['darwin']);
    expect(manifest.skills).toEqual([resolve('/plugins/acme/skills/review.md')]);
    expect(manifest.commands).toEqual(['doctor']);
    expect(manifest.mcpServers?.[0].name).toBe('docs');
    expect(manifest.lspServers?.[0].name).toBe('ts');
  });

  it('preserves requiresUserActivation across stdio mcp server', () => {
    const manifest = parsePluginManifest({
      name: 'p',
      version: '1.0.0',
      mcpServers: [
        { name: 'cua-driver', type: 'stdio', command: 'cua-driver', args: ['mcp'], requiresUserActivation: true },
      ],
    }, '/plugins/p');
    expect(manifest.mcpServers?.[0]).toMatchObject({
      name: 'cua-driver',
      type: 'stdio',
      requiresUserActivation: true,
    });
  });

  it('preserves requiresUserActivation across sse / http / ws mcp servers', () => {
    const manifest = parsePluginManifest({
      name: 'p',
      version: '1.0.0',
      mcpServers: [
        { name: 'sse-srv', type: 'sse', url: 'https://x/sse', requiresUserActivation: true },
        { name: 'http-srv', type: 'http', url: 'https://x/http', requiresUserActivation: true },
        { name: 'ws-srv', type: 'ws', url: 'wss://x/ws', requiresUserActivation: true },
      ],
    }, '/plugins/p');
    expect(manifest.mcpServers?.map((s) => ({ name: s.name, raised: s.requiresUserActivation }))).toEqual([
      { name: 'sse-srv', raised: true },
      { name: 'http-srv', raised: true },
      { name: 'ws-srv', raised: true },
    ]);
  });

  it('omits requiresUserActivation when not set in manifest', () => {
    const manifest = parsePluginManifest({
      name: 'p',
      version: '1.0.0',
      mcpServers: [{ name: 'docs', type: 'stdio', command: 'docs' }],
    }, '/plugins/p');
    expect(manifest.mcpServers?.[0].requiresUserActivation).toBeUndefined();
  });
});
