import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../../src/types.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';
import { resolveRuntimeModelBinding } from '../../../src/ai/providers/control-plane.js';
import { resolveModelCapabilities } from '../../../src/ai/runtime/model-capabilities.js';

describe('resolveRuntimeModelBinding', () => {
  const OLD_ENV = process.env;

  function createOpenAICompatibleConfig(input: {
    providerId: string;
    modelId: string;
    wireModel: string;
    baseUrl: string;
    providerType?: 'first_party' | 'custom';
    protocol?: 'anthropic' | 'openai_legacy' | 'openai_responses';
    runtimeOptions?: {
      contextLimit?: number;
      reasoningEffort?: 'low' | 'high' | 'max';
    };
  }): Config {
    return {
      schemaVersion: 2,
      defaultProvider: input.providerId,
      defaultModelId: input.modelId,
      providers: {
        [input.providerId]: {
          type: input.providerType ?? 'custom',
          protocol: input.protocol ?? 'openai_legacy',
          apiKey: 'sk-kimi',
          baseUrl: input.baseUrl,
        },
      },
      models: {
        [input.modelId]: {
          provider: input.providerId,
          model: input.wireModel,
          label: input.modelId,
          ...(input.runtimeOptions ? { runtimeOptions: input.runtimeOptions } : {}),
        },
      },
      defaultMode: 'interactive',
      channels: {},
    };
  }

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
      providerType: 'first_party',
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

  it('marks built-in DeepSeek V4 bindings as image-capable for pasted images and CUA screenshots', () => {
    const config: Config = {
      schemaVersion: 2,
      defaultProvider: 'deepseek',
      defaultModelId: 'deepseek-default',
      providers: {
        deepseek: {
          type: 'first_party',
          protocol: 'openai_legacy',
          apiKey: 'sk-deepseek',
        },
      },
      models: {
        'deepseek-default': {
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
          label: 'DeepSeek V4 Pro',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    };

    expect(resolveRuntimeModelBinding(config)).toMatchObject({
      providerId: 'deepseek',
      modelId: 'deepseek-default',
      wireModel: 'deepseek-v4-pro',
      protocol: 'openai_legacy',
      capabilities: ['tools', 'image_in'],
    });
  });

  it('does not let an old kimi-default to kimi-k2.7 mapping inherit K3 runtime policy', () => {
    const config = createOpenAICompatibleConfig({
      providerId: 'kimi',
      providerType: 'first_party',
      modelId: 'kimi-default',
      wireModel: 'kimi-k2.7',
      baseUrl: 'https://api.kimi.com/coding/v1',
    });

    expect(resolveRuntimeModelBinding(config)).not.toHaveProperty('runtimeOptions');
  });

  it('applies safe K3 defaults to a manual official binding without a catalog model id', () => {
    const config = createOpenAICompatibleConfig({
      providerId: 'manual-kimi',
      modelId: 'manual-k3',
      wireModel: 'k3',
      baseUrl: 'https://api.kimi.com/coding/v1',
    });

    expect(resolveRuntimeModelBinding(config).runtimeOptions).toEqual({
      contextLimit: 262_144,
      reasoningEffort: 'high',
    });
  });

  it('preserves configured K3 1M context and max reasoning in the resolved binding', () => {
    const config = createOpenAICompatibleConfig({
      providerId: 'manual-kimi',
      modelId: 'manual-k3',
      wireModel: 'k3',
      baseUrl: 'https://api.kimi.com/coding/v1',
      runtimeOptions: {
        contextLimit: 1_048_576,
        reasoningEffort: 'max',
      },
    });

    expect(resolveRuntimeModelBinding(config).runtimeOptions).toEqual({
      contextLimit: 1_048_576,
      reasoningEffort: 'max',
    });
  });

  it('copies custom provider type into the resolved binding identity', () => {
    const config = createOpenAICompatibleConfig({
      providerId: 'manual-kimi',
      providerType: 'custom',
      modelId: 'manual-k3',
      wireModel: 'k3',
      baseUrl: 'https://api.kimi.com/coding/v1',
    });

    expect(resolveRuntimeModelBinding(config).providerType).toBe('custom');
  });

  it.each(['openai_responses', 'anthropic'] as const)(
    'does not apply matching Kimi K3 catalog metadata through %s protocol',
    (protocol) => {
      const config = createOpenAICompatibleConfig({
        providerId: 'kimi',
        providerType: 'first_party',
        modelId: 'kimi-k3',
        wireModel: 'k3',
        baseUrl: 'https://api.kimi.com/coding/v1',
        protocol,
      });

      expect(resolveRuntimeModelBinding(config)).not.toHaveProperty('runtimeOptions');
    },
  );

  it('does not apply Kimi catalog policy to K3 on a custom endpoint', () => {
    const config = createOpenAICompatibleConfig({
      providerId: 'kimi',
      providerType: 'custom',
      modelId: 'kimi-k3',
      wireModel: 'k3',
      baseUrl: 'https://proxy.example.com/coding/v1',
      runtimeOptions: {
        contextLimit: 1_048_576,
        reasoningEffort: 'max',
      },
    });

    expect(resolveRuntimeModelBinding(config)).not.toHaveProperty('runtimeOptions');
  });

  it('preserves provider-neutral runtime options for a custom provider model named K3', () => {
    const config = createOpenAICompatibleConfig({
      providerId: 'acme',
      providerType: 'custom',
      modelId: 'acme-k3',
      wireModel: 'k3',
      baseUrl: 'https://api.acme.example/v1',
      runtimeOptions: {
        contextLimit: 128_000,
        reasoningEffort: 'low',
      },
    });

    expect(resolveRuntimeModelBinding(config).runtimeOptions).toEqual({
      contextLimit: 128_000,
      reasoningEffort: 'low',
    });
  });

  it('drops stale K3 runtime options from an official Kimi K2.7 binding', () => {
    const config = createOpenAICompatibleConfig({
      providerId: 'kimi',
      providerType: 'first_party',
      modelId: 'kimi-k2.7',
      wireModel: 'kimi-k2.7',
      baseUrl: 'https://api.kimi.com/coding/v1',
      runtimeOptions: {
        contextLimit: 1_048_576,
        reasoningEffort: 'max',
      },
    });

    expect(resolveRuntimeModelBinding(config)).not.toHaveProperty('runtimeOptions');
  });
});

describe('createAdapterFromBinding', () => {
  it('creates adapters from the resolved runtime binding instead of raw config branches', () => {
    const adapter = createAdapterFromBinding({
      providerId: 'gemini',
      providerType: 'first_party',
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

  it('propagates explicit image input capability from OpenAI-compatible bindings', () => {
    const adapter = createAdapterFromBinding({
      providerId: 'deepseek',
      providerType: 'first_party',
      modelId: 'deepseek-v4-pro',
      wireModel: 'deepseek-v4-pro',
      protocol: 'openai_legacy',
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
      headers: {},
      capabilities: ['tools', 'image_in'],
    });

    expect(resolveModelCapabilities(adapter).supportsImageInput).toBe(true);
  });
});
