import { describe, expect, it } from 'vitest';
import { parsePluginManifest } from '../../../src/platform/plugins/manifest.js';

describe('plugin manifest', () => {
  it('parses plugin manifest with skills agents hooks and commands', () => {
    const manifest = parsePluginManifest({
      name: 'acme-tools',
      version: '1.0.0',
      skills: ['skills/review.md'],
      agents: ['agents/reviewer.md'],
      hooks: ['hooks/pre.js'],
      commands: ['doctor'],
      mcpServers: [{ name: 'docs', command: 'node docs-server.js' }],
      lspServers: [{ name: 'ts', command: 'node lsp-server.js' }],
    }, '/plugins/acme');

    expect(manifest.name).toBe('acme-tools');
    expect(manifest.skills).toEqual(['/plugins/acme/skills/review.md']);
    expect(manifest.commands).toEqual(['doctor']);
    expect(manifest.mcpServers?.[0].name).toBe('docs');
    expect(manifest.lspServers?.[0].name).toBe('ts');
  });
});
