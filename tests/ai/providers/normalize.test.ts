import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../../../src/ai/providers/normalize.js';
import { getProviderProfile } from '../../../src/ai/providers/registry.js';
import { DEFAULT_INTENT_BOUNDARY_CONFIG } from '../../../src/types.js';

describe('normalizeConfig', () => {
  it('upgrades a v1 claude config into provider and model catalogs', () => {
    const normalized = normalizeConfig({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: {
          model: 'claude-opus-4-6',
          apiKey: 'sk-ant',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    });

    expect(normalized.schemaVersion).toBe(2);
    expect(normalized.defaultProvider).toBe('anthropic');
    expect(normalized.defaultModelId).toBe('anthropic-default');
    expect(normalized.providers.anthropic).toMatchObject({
      type: 'first_party',
      protocol: 'anthropic',
      apiKey: 'sk-ant',
    });
    expect(normalized.models['anthropic-default']).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
    });
  });

  it('preserves provider default metadata for a legacy non-Kimi explicit model', () => {
    const normalized = normalizeConfig({
      schemaVersion: 1,
      defaultModel: 'openai',
      models: {
        openai: {
          model: 'o3',
          apiKey: 'sk-openai',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    });
    const entry = normalized.models['openai-default'];

    expect(entry).toMatchObject({
      provider: 'openai',
      model: 'o3',
      label: 'GPT-4o',
      capabilities: ['tools'],
    });
    expect(entry).not.toHaveProperty('runtimeOptions');
  });

  it('promotes known kimi coding custom config into the kimi provider profile', () => {
    const normalized = normalizeConfig({
      schemaVersion: 1,
      defaultModel: 'custom',
      models: {
        custom: {
          baseUrl: 'https://api.kimi.com/coding/v1',
          apiKey: 'sk-kimi',
          model: 'kimi-for-coding',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    });

    expect(normalized.defaultProvider).toBe('kimi');
    expect(normalized.defaultModelId).toBe('kimi-default');
    expect(normalized.providers.kimi).toMatchObject({
      protocol: 'openai_legacy',
      baseUrl: 'https://api.kimi.com/coding/v1',
      apiKey: 'sk-kimi',
    });
    expect(normalized.models['kimi-default']).toMatchObject({
      provider: 'kimi',
      model: 'kimi-for-coding',
    });
  });

  it('pins a schema-v1 Kimi config without a model to the previous K2.7 default', () => {
    const normalized = normalizeConfig({
      schemaVersion: 1,
      defaultModel: 'custom',
      models: {
        custom: {
          baseUrl: 'https://api.kimi.com/coding/v1',
          apiKey: 'sk-kimi',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    });

    expect(normalized.schemaVersion).toBe(2);
    expect(normalized.defaultModelId).toBe('kimi-default');
    expect(normalized.models['kimi-default']).toMatchObject({
      provider: 'kimi',
      model: 'kimi-k2.7',
      label: 'Kimi K2.7',
    });
    expect(normalized.models['kimi-default'].runtimeOptions).toBeUndefined();
  });

  it('copies catalog runtime options for an explicit schema-v1 K3 model', () => {
    const profile = getProviderProfile('kimi');
    const normalized = normalizeConfig({
      schemaVersion: 1,
      defaultModel: 'custom',
      models: {
        custom: {
          baseUrl: 'https://api.kimi.com/coding/v1',
          apiKey: 'sk-kimi',
          model: 'k3',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    });
    const entry = normalized.models['kimi-default'];

    expect(entry).toMatchObject({
      provider: 'kimi',
      model: 'k3',
      label: 'Kimi K3',
      runtimeOptions: {
        contextLimit: 262_144,
        reasoningEffort: 'high',
      },
    });
    expect(entry.runtimeOptions).not.toBe(profile?.defaultModel.runtimeOptions);

    entry.runtimeOptions!.contextLimit = 1_048_576;
    expect(profile?.defaultModel.runtimeOptions?.contextLimit).toBe(262_144);
  });

  it('preserves an existing schema-v2 kimi-default K2.7 entry without K3 options', () => {
    const input = {
      schemaVersion: 2 as const,
      defaultProvider: 'kimi',
      defaultModelId: 'kimi-default',
      providers: {
        kimi: {
          type: 'first_party' as const,
          protocol: 'openai_legacy' as const,
          baseUrl: 'https://api.kimi.com/coding/v1',
        },
      },
      models: {
        'kimi-default': {
          provider: 'kimi',
          model: 'kimi-k2.7',
          label: 'Kimi K2.7',
        },
      },
      defaultMode: 'interactive' as const,
      intentBoundary: DEFAULT_INTENT_BOUNDARY_CONFIG,
      channels: {},
    };

    const normalized = normalizeConfig(input);

    expect(normalized.schemaVersion).toBe(2);
    expect(normalized.defaultModelId).toBe('kimi-default');
    expect(normalized.models['kimi-default']).toEqual({
      provider: 'kimi',
      model: 'kimi-k2.7',
      label: 'Kimi K2.7',
    });
  });

  it('normalizes schema v2 config with default intent boundary settings', () => {
    const input = {
      schemaVersion: 2 as const,
      defaultProvider: 'openai',
      defaultModelId: 'openai-default',
      providers: {
        openai: {
          type: 'first_party' as const,
          protocol: 'openai_legacy' as const,
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com/v1',
        },
      },
      models: {
        'openai-default': {
          provider: 'openai',
          model: 'gpt-4o',
          label: 'OpenAI Default',
        },
      },
      defaultMode: 'interactive' as const,
      channels: {},
    };

    expect(normalizeConfig(input)).toEqual({
      ...input,
      intentBoundary: DEFAULT_INTENT_BOUNDARY_CONFIG,
      automations: {
        globalBackgroundAutoRunEnabled: true,
      },
    });
  });

  it('defaults background auto-run to enabled while preserving an explicit pause', () => {
    const input = {
      schemaVersion: 2 as const,
      defaultProvider: 'openai',
      defaultModelId: 'openai-default',
      providers: {
        openai: {
          type: 'first_party' as const,
          protocol: 'openai_legacy' as const,
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com/v1',
        },
      },
      models: {
        'openai-default': {
          provider: 'openai',
          model: 'gpt-4o',
          label: 'OpenAI Default',
        },
      },
      defaultMode: 'interactive' as const,
      intentBoundary: DEFAULT_INTENT_BOUNDARY_CONFIG,
      automations: {
        globalBackgroundAutoRunEnabled: false,
      },
    };

    expect(normalizeConfig(input).automations).toEqual({
      globalBackgroundAutoRunEnabled: false,
    });
    expect(normalizeConfig({ ...input, automations: undefined }).automations).toEqual({
      globalBackgroundAutoRunEnabled: true,
    });
  });
});
