import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config, LegacyConfig } from '../../../src/types.js';
import type { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';
import {
  MissingProviderApiKeyError,
  resolveRuntimeModelBinding,
} from '../../../src/ai/providers/control-plane.js';
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

  it('throws a typed missing-key error whose primary recovery is xiaok login', () => {
    const config = createOpenAICompatibleConfig({
      providerId: 'deepseek',
      modelId: 'deepseek-default',
      wireModel: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      providerType: 'first_party',
    });
    delete config.providers.deepseek.apiKey;

    try {
      resolveRuntimeModelBinding(config);
      expect.fail('expected a missing provider API key error');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingProviderApiKeyError);
      expect(error).toMatchObject({
        code: 'missing_provider_api_key',
        providerId: 'deepseek',
      });
      expect(String(error)).toContain('xiaok login');
      expect(String(error)).toContain('xiaok config set api-key <key> --provider deepseek');
    }
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
      // modelId 是非规范的 'openai-project'，双键匹配不中；wireModel 回退命中
      // 目录里的 gpt-4.1 并带上其官方窗口。
      runtimeOptions: { contextLimit: 1_047_576 },
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

  it('does not mark DeepSeek V4 bindings image-capable, since the API silently drops images', () => {
    // 官方三处独立说明不支持图片输入；Responses API 文档还写明 `input_image`
    // 「不会报错，但会被替换成占位文本」。标成支持 = 用户粘了图、模型没看到、
    // 也没人告诉他，比直接不给粘更糟。
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
      capabilities: ['tools', 'thinking'],
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

  it('promotes a legacy Kimi config through one binding into the strict K3 harness', () => {
    const legacyConfig: LegacyConfig = {
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
    };

    const binding = resolveRuntimeModelBinding(legacyConfig);
    const adapter = createAdapterFromBinding(binding) as OpenAIAdapter;

    expect(binding).toEqual({
      providerId: 'kimi',
      providerType: 'first_party',
      modelId: 'kimi-default',
      wireModel: 'k3',
      protocol: 'openai_legacy',
      apiKey: 'sk-kimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
      headers: {},
      capabilities: ['tools', 'thinking'],
      runtimeOptions: {
        contextLimit: 262_144,
        reasoningEffort: 'high',
      },
    });
    expect(adapter.harnessContext.identity).toEqual({
      providerId: binding.providerId,
      providerType: binding.providerType,
      protocol: binding.protocol,
      canonicalBaseUrl: binding.baseUrl,
      wireModel: binding.wireModel,
      capabilities: binding.capabilities,
    });
    expect(adapter.harnessContext.profile.id).toBe('kimi-k3-coding-openai');
  });

  it('canonicalizes a schema-v2 official endpoint before strict adapter fingerprinting', () => {
    const uppercaseConfig = createOpenAICompatibleConfig({
      providerId: 'kimi',
      providerType: 'first_party',
      modelId: 'kimi-k3',
      wireModel: 'k3',
      baseUrl: 'https://API.KIMI.COM/coding/v1',
    });
    const canonicalConfig = createOpenAICompatibleConfig({
      providerId: 'kimi',
      providerType: 'first_party',
      modelId: 'kimi-k3',
      wireModel: 'k3',
      baseUrl: 'https://api.kimi.com/coding/v1',
    });

    const uppercaseBinding = resolveRuntimeModelBinding(uppercaseConfig);
    const canonicalBinding = resolveRuntimeModelBinding(canonicalConfig);
    const uppercaseAdapter = createAdapterFromBinding(uppercaseBinding) as OpenAIAdapter;
    const canonicalAdapter = createAdapterFromBinding(canonicalBinding) as OpenAIAdapter;

    expect(uppercaseBinding.runtimeOptions).toEqual({
      contextLimit: 262_144,
      reasoningEffort: 'high',
    });
    expect(uppercaseAdapter.harnessContext.identity.canonicalBaseUrl)
      .toBe('https://api.kimi.com/coding/v1');
    expect(uppercaseAdapter.harnessContext.profile.id)
      .toBe('kimi-k3-coding-openai');
    expect(uppercaseAdapter.harnessContext.identityFingerprint)
      .toBe(canonicalAdapter.harnessContext.identityFingerprint);
  });

  it('recovers GLM catalog context limit for a modelId synthesized by Desktop', () => {
    // Desktop 的 saveModelConfig 把 'GLM-5.2' 合成为 modelId 'glm-glm-5.2'，
    // 与 catalog 的 'glm-5.2' 双键失配。存量配置不应因此丢掉窗口。
    const config = createOpenAICompatibleConfig({
      providerId: 'glm',
      providerType: 'first_party',
      modelId: 'glm-glm-5.2',
      wireModel: 'GLM-5.2',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    });

    expect(resolveRuntimeModelBinding(config).runtimeOptions)
      .toEqual({ contextLimit: 1_000_000 });
  });

  it('recovers GLM catalog context limit for a modelId synthesized by the CLI', () => {
    // CLI 的 sanitizer 把点换成连字符，得到 'glm-glm-5-2'。
    const config = createOpenAICompatibleConfig({
      providerId: 'glm',
      providerType: 'first_party',
      modelId: 'glm-glm-5-2',
      wireModel: 'GLM-5.2',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    });

    expect(resolveRuntimeModelBinding(config).runtimeOptions)
      .toEqual({ contextLimit: 1_000_000 });
  });

  it('applies the smaller published window for GLM-4.5 instead of the 200K default', () => {
    // GLM-4.5 官方窗口是 128K。按 200K 兜底会让压缩阈值 170K 超过真实上限。
    const config = createOpenAICompatibleConfig({
      providerId: 'glm',
      providerType: 'first_party',
      modelId: 'glm-4.5',
      wireModel: 'glm-4.5',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    });

    expect(resolveRuntimeModelBinding(config).runtimeOptions)
      .toEqual({ contextLimit: 128_000 });
  });

  it('does not lend first-party GLM catalog metadata to a custom provider of the same id', () => {
    // 危险反例：Desktop 允许用户自定义 provider 名，输入 "GLM" 即得到 id 'glm'。
    // 该 provider 指向用户自建代理，真实窗口未知，绝不能继承官方 1M。
    const config = createOpenAICompatibleConfig({
      providerId: 'glm',
      providerType: 'custom',
      modelId: 'glm-glm-5.2',
      wireModel: 'GLM-5.2',
      baseUrl: 'https://proxy.example.com/v1',
    });

    expect(resolveRuntimeModelBinding(config)).not.toHaveProperty('runtimeOptions');
  });

  it('still honors runtime options a custom provider configured explicitly', () => {
    // first-party 闸门只拦 catalog 查询，不能拦用户自己填的值。
    const config = createOpenAICompatibleConfig({
      providerId: 'glm',
      providerType: 'custom',
      modelId: 'glm-glm-5.2',
      wireModel: 'GLM-5.2',
      baseUrl: 'https://proxy.example.com/v1',
      runtimeOptions: { contextLimit: 64_000 },
    });

    expect(resolveRuntimeModelBinding(config).runtimeOptions)
      .toEqual({ contextLimit: 64_000 });
  });

  it.each([
    ['k3', 'https://api.kimi.com/coding/v1', true],
    ['k3-256k', 'https://api.kimi.com/coding/v1', true],
    ['k3', 'https://proxy.example.com/coding/v1', false],
    ['k3-256k', 'https://proxy.example.com/coding/v1', false],
  ] as const)(
    'keeps Kimi %s on %s runtime-option eligibility unchanged',
    (wireModel, baseUrl, eligible) => {
      const config = createOpenAICompatibleConfig({
        providerId: 'kimi',
        providerType: 'first_party',
        modelId: `kimi-${wireModel}`,
        wireModel,
        baseUrl,
      });

      const binding = resolveRuntimeModelBinding(config);
      if (eligible) {
        expect(binding.runtimeOptions).toEqual({
          contextLimit: 262_144,
          reasoningEffort: 'high',
        });
      } else {
        expect(binding).not.toHaveProperty('runtimeOptions');
      }
    },
  );
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

describe('contextLimit reaches every protocol, not just openai_legacy', () => {
  function bind(input: {
    providerId: string;
    providerType?: 'first_party' | 'custom';
    protocol: 'anthropic' | 'openai_responses';
    wireModel: string;
    contextLimit?: number;
    reasoningEffort?: 'low' | 'high' | 'max';
  }) {
    return createAdapterFromBinding({
      providerId: input.providerId,
      providerType: input.providerType ?? 'first_party',
      modelId: `${input.providerId}-under-test`,
      wireModel: input.wireModel,
      protocol: input.protocol,
      apiKey: 'sk-test',
      headers: {},
      capabilities: ['tools'],
      ...(input.contextLimit !== undefined || input.reasoningEffort !== undefined
        ? {
            runtimeOptions: {
              ...(input.contextLimit !== undefined ? { contextLimit: input.contextLimit } : {}),
              ...(input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort } : {}),
            },
          }
        : {}),
    });
  }

  it('carries contextLimit into the anthropic protocol', () => {
    // 之前 models.ts 的 anthropic 分支只传 modelCapabilitiesFromFlags，
    // runtimeOptions 被整体丢弃 —— Claude 的窗口因此完全不可配。
    const adapter = bind({
      providerId: 'anthropic',
      protocol: 'anthropic',
      wireModel: 'claude-sonnet-4-6',
      contextLimit: 1_000_000,
    });

    expect(resolveModelCapabilities(adapter).contextLimit).toBe(1_000_000);
  });

  it('carries contextLimit into the openai_responses protocol', () => {
    const adapter = bind({
      providerId: 'gemini',
      protocol: 'openai_responses',
      wireModel: 'gemini-2.5-pro',
      contextLimit: 1_048_576,
    });

    expect(resolveModelCapabilities(adapter).contextLimit).toBe(1_048_576);
  });

  it('does not leak reasoningEffort into model capabilities', () => {
    // reasoningEffort 是 OpenAI-compatible 的请求字段；Claude 用 thinking.type、
    // Gemini 用别的机制，透传过去没有接收方。
    for (const protocol of ['anthropic', 'openai_responses'] as const) {
      const adapter = bind({
        providerId: protocol === 'anthropic' ? 'anthropic' : 'gemini',
        protocol,
        wireModel: protocol === 'anthropic' ? 'claude-sonnet-4-6' : 'gemini-2.5-pro',
        contextLimit: 500_000,
        reasoningEffort: 'max',
      });

      expect(adapter.getCapabilities?.(), protocol).not.toHaveProperty('reasoningEffort');
    }
  });

  it('re-resolves the window on cloneWithModel instead of carrying the previous one', () => {
    // 关键回归：subagent 换模型时，1M 的窗口不能被带到一个未知/更小的模型上。
    // 断言目标刻意选一个 catalog 里没有的 wireModel —— 若实现只是透传旧
    // capabilityOverrides，这条会拿到 1_000_000 而失败。
    for (const [providerId, protocol, wireModel] of [
      ['anthropic', 'anthropic', 'claude-sonnet-4-6'],
      ['gemini', 'openai_responses', 'gemini-2.5-pro'],
    ] as const) {
      const adapter = bind({ providerId, protocol, wireModel, contextLimit: 1_000_000 });
      expect(resolveModelCapabilities(adapter).contextLimit, providerId).toBe(1_000_000);

      const cloned = (adapter as unknown as {
        cloneWithModel(model: string): typeof adapter;
      }).cloneWithModel('not-in-any-catalog');

      expect(resolveModelCapabilities(cloned).contextLimit, providerId).not.toBe(1_000_000);
    }
  });

  it('does not lend catalog windows to a custom provider sharing a first-party id', () => {
    // 与 control-plane 的 first-party 闸门同一条规则。
    const adapter = bind({
      providerId: 'gemini',
      providerType: 'custom',
      protocol: 'openai_responses',
      wireModel: 'gemini-2.5-pro',
      contextLimit: 700_000,
    });

    // 用户显式配置的值仍要生效
    expect(resolveModelCapabilities(adapter).contextLimit).toBe(700_000);

    // 但 clone 到别的模型时不得从官方目录借值
    const cloned = (adapter as unknown as {
      cloneWithModel(model: string): typeof adapter;
    }).cloneWithModel('gemini-2.5-flash');
    expect(resolveModelCapabilities(cloned).contextLimit).not.toBe(1_048_576);
  });
});
