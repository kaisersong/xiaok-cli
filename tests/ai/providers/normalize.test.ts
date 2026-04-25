import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../../../src/ai/providers/normalize.js';

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

  it('passes schema v2 config through unchanged', () => {
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

    expect(normalizeConfig(input)).toEqual(input);
  });
});
