import { describe, expect, it } from 'vitest';

import {
  classifyMcpServer,
  validateRegistry,
  BUILT_IN_MCP_CLASSIFICATIONS,
  type McpClassificationEntry,
} from '../../../src/platform/mcp/server-classification.js';
import type { NamedMcpServerConfig } from '../../../src/platform/mcp/types.js';

function pluginCua(overrides: Partial<NamedMcpServerConfig> = {}): NamedMcpServerConfig {
  return {
    name: 'cua-driver',
    type: 'stdio',
    command: '/usr/local/bin/cua-driver',
    args: ['mcp'],
    source: { origin: 'plugin', pluginName: 'cua-computer-use', pluginDir: '/plugins/cua-computer-use' },
    ...overrides,
  };
}

function pluginGeneric(name: string, pluginName: string): NamedMcpServerConfig {
  return {
    name,
    type: 'stdio',
    command: '/usr/local/bin/whatever',
    source: { origin: 'plugin', pluginName, pluginDir: `/plugins/${pluginName}` },
  };
}

function settingsServer(name: string): NamedMcpServerConfig {
  return {
    name,
    type: 'stdio',
    command: '/some/cmd',
    source: { origin: 'settings' },
  };
}

describe('classifyMcpServer (BUILT_IN registry)', () => {
  it('matches official cua-driver by pluginName + name → lazy + shared-singleton-never-stop + diagnostics', () => {
    const policy = classifyMcpServer(pluginCua());
    expect(policy.activation).toEqual({ mode: 'lazy', adapter: 'cua-computer-use-wrapper' });
    expect(policy.disposeOwnership).toBe('shared-singleton-never-stop');
    expect(policy.diagnostics).toEqual(['orphan-daemon-risk', 'high-cpu-idle']);
    expect(policy.source).toBe('registry');
    expect(policy.reason).toMatch(/cua-driver/);
  });

  it('does NOT match third-party plugin that happens to name its server cua-driver', () => {
    const policy = classifyMcpServer(pluginGeneric('cua-driver', 'evil-clone'));
    expect(policy.activation).toEqual({ mode: 'eager' });
    expect(policy.source).toBe('default');
  });

  it('does NOT match settings-origin cua-driver (no plugin source)', () => {
    const policy = classifyMcpServer(settingsServer('cua-driver'));
    expect(policy.activation).toEqual({ mode: 'eager' });
    expect(policy.source).toBe('default');
  });

  it('does NOT match plugin-origin cua-driver missing source metadata', () => {
    const policy = classifyMcpServer({
      name: 'cua-driver',
      type: 'stdio',
      command: '/usr/local/bin/cua-driver',
    });
    expect(policy.activation).toEqual({ mode: 'eager' });
    expect(policy.source).toBe('default');
  });
});

describe('classifyMcpServer (legacy-manifest fallback)', () => {
  it('lazy fallback only on official CUA identity with requiresUserActivation', () => {
    const policy = classifyMcpServer(
      pluginCua({ requiresUserActivation: true }),
      [], // empty registry → fallback path
    );
    expect(policy.activation).toEqual({ mode: 'lazy', adapter: 'cua-computer-use-wrapper' });
    expect(policy.disposeOwnership).toBe('shared-singleton-never-stop');
    expect(policy.source).toBe('legacy-manifest');
  });

  it('non-CUA plugin with requiresUserActivation does NOT enter lazy wrapper; degrades to eager + observable reason', () => {
    const policy = classifyMcpServer(
      { ...pluginGeneric('weird-driver', 'random-plugin'), requiresUserActivation: true },
      [],
    );
    expect(policy.activation).toEqual({ mode: 'eager' });
    expect(policy.disposeOwnership).toBe('owned-child');
    expect(policy.source).toBe('legacy-manifest');
    expect(policy.reason).toMatch(/only honored for official cua-computer-use/i);
  });

  it('settings origin requiresUserActivation does NOT enter lazy wrapper (no plugin identity)', () => {
    const policy = classifyMcpServer(
      { ...settingsServer('cua-driver'), requiresUserActivation: true },
      [],
    );
    expect(policy.activation).toEqual({ mode: 'eager' });
    expect(policy.source).toBe('legacy-manifest');
    expect(policy.reason).toMatch(/only honored for official/i);
  });

  it('no requiresUserActivation and no registry match → default eager with empty reason', () => {
    const policy = classifyMcpServer(pluginGeneric('docs', 'docs-plugin'), []);
    expect(policy.activation).toEqual({ mode: 'eager' });
    expect(policy.source).toBe('default');
    expect(policy.reason).toBe('');
  });
});

describe('classifyMcpServer (multi-match guard)', () => {
  it('throws when two registry entries match the same server', () => {
    const overlap: McpClassificationEntry[] = [
      {
        match: { pluginName: 'cua-computer-use', name: 'cua-driver' },
        policy: {
          activation: { mode: 'lazy', adapter: 'cua-computer-use-wrapper' },
          disposeOwnership: 'shared-singleton-never-stop',
          diagnostics: [],
          reason: 'first',
        },
      },
      {
        match: { pluginName: 'cua-computer-use', name: 'cua-driver' },
        policy: {
          activation: { mode: 'lazy', adapter: 'cua-computer-use-wrapper' },
          disposeOwnership: 'shared-singleton-never-stop',
          diagnostics: [],
          reason: 'second',
        },
      },
    ];
    expect(() => classifyMcpServer(pluginCua(), overlap)).toThrow(/[Aa]mbiguous|2 entries match/);
  });
});

describe('validateRegistry (adapter integrity)', () => {
  it('rejects cua-computer-use-wrapper adapter on a non-CUA identity', () => {
    const bad: McpClassificationEntry[] = [
      {
        match: { pluginName: 'random-plugin', name: 'cua-driver' },
        policy: {
          activation: { mode: 'lazy', adapter: 'cua-computer-use-wrapper' },
          disposeOwnership: 'owned-child',
          diagnostics: [],
          reason: 'should fail',
        },
      },
    ];
    expect(() => validateRegistry(bad)).toThrow(/cua-computer-use-wrapper/);
  });

  it('rejects cua-computer-use-wrapper adapter when match.name is not cua-driver', () => {
    const bad: McpClassificationEntry[] = [
      {
        match: { pluginName: 'cua-computer-use', name: 'something-else' },
        policy: {
          activation: { mode: 'lazy', adapter: 'cua-computer-use-wrapper' },
          disposeOwnership: 'owned-child',
          diagnostics: [],
          reason: 'should fail',
        },
      },
    ];
    expect(() => validateRegistry(bad)).toThrow(/cua-computer-use-wrapper/);
  });

  it('accepts the BUILT_IN registry', () => {
    expect(() => validateRegistry(BUILT_IN_MCP_CLASSIFICATIONS)).not.toThrow();
  });
});

describe('BUILT_IN_MCP_CLASSIFICATIONS deep-frozen', () => {
  it('attempts to mutate the array throw or no-op (TypeError in strict mode)', () => {
    const original = BUILT_IN_MCP_CLASSIFICATIONS.length;
    expect(() => {
      (BUILT_IN_MCP_CLASSIFICATIONS as unknown as McpClassificationEntry[]).push({
        match: { name: 'fake' },
        policy: {
          activation: { mode: 'eager' },
          disposeOwnership: 'owned-child',
          diagnostics: [],
          reason: '',
        },
      });
    }).toThrow();
    expect(BUILT_IN_MCP_CLASSIFICATIONS.length).toBe(original);
  });

  it('attempts to mutate a nested entry throw', () => {
    expect(() => {
      (BUILT_IN_MCP_CLASSIFICATIONS[0].policy.diagnostics as unknown as string[]).push('zzz');
    }).toThrow();
  });
});
