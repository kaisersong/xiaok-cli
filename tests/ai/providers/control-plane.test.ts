import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../../src/types.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';
import { resolveRuntimeModelBinding } from '../../../src/ai/providers/control-plane.js';

describe('resolveRuntimeModelBinding', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('resolves one configured model id into one runtime binding with merged transport settings', () => {
    process.env.XIAOK_OPENAI_API_KEY = 'sk-env-openai';

    const config: Config = {
      schemaVersion: 2,
      defaultProvider: 'openai',
      defaultModelId: 'openai-project',
      providers: {
        openai: {
          type: 'first_party',
          protocol: 'openai_legacy',
          apiKey: 'sk-config-openai',
          baseUrl: 'https://proxy.example.com/v1',
          headers: {
            'x-project': 'xiaok-cli',
          },
        },
      },
      models: {
        'openai-project': {
          provider: 'openai',
          model: 'gpt-4.1',
          label: 'OpenAI Project',
          capabilities: ['tools', 'reasoning'],
        },
      },
      defaultMode: 'interactive',
      channels: {},
    };

    expect(resolveRuntimeModelBinding(config)).toEqual({
      providerId: 'openai',
      modelId: 'openai-project',
      wireModel: 'gpt-4.1',
      protocol: 'openai_legacy',
      apiKey: 'sk-env-openai',
      baseUrl: 'https://proxy.example.com/v1',
      headers: {
        'x-project': 'xiaok-cli',
      },
      capabilities: ['tools', 'reasoning'],
    });
  });

  it('falls back to provider profile defaults before adapter construction', () => {
    const config: Config = {
      schemaVersion: 2,
      defaultProvider: 'gemini',
      defaultModelId: 'gemini-thinking',
      providers: {
        gemini: {
          type: 'first_party',
          protocol: 'openai_responses',
          apiKey: 'sk-gemini',
        },
      },
      models: {
        'gemini-thinking': {
          provider: 'gemini',
          model: 'gemini-2.5-pro',
          label: 'Gemini Thinking',
          capabilities: ['tools', 'thinking'],
        },
      },
      defaultMode: 'interactive',
      channels: {},
    };

    expect(resolveRuntimeModelBinding(config)).toMatchObject({
      providerId: 'gemini',
      modelId: 'gemini-thinking',
      wireModel: 'gemini-2.5-pro',
      protocol: 'openai_responses',
      apiKey: 'sk-gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      headers: {},
      capabilities: ['tools', 'thinking'],
    });
  });
});

describe('createAdapterFromBinding', () => {
  it('creates adapters from the resolved runtime binding instead of raw config branches', () => {
    const adapter = createAdapterFromBinding({
      providerId: 'gemini',
      modelId: 'gemini-thinking',
      wireModel: 'gemini-2.5-pro',
      protocol: 'openai_responses',
      apiKey: 'sk-gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      headers: {
        'x-foo': 'bar',
      },
      capabilities: ['tools', 'thinking'],
    });

    expect(adapter.constructor.name).toBe('OpenAIResponsesAdapter');
  });
});
