import { describe, expect, it } from 'vitest';
import { resolveRuntimeModelBinding } from '../../../src/ai/providers/control-plane.js';
import { normalizeConfig } from '../../../src/ai/providers/normalize.js';
import { getProviderProfile } from '../../../src/ai/providers/registry.js';
import type { LegacyConfig } from '../../../src/types.js';
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

  it('inherits deepseek legacy wire capabilities during v1 upgrade instead of the new default', () => {
    // default 换 deepseek-flash 后，v1 存量配置(custom endpoint 钉死
    // deepseek-v4-pro)迁移时必须按 wire 继承该变体的能力(纯文本)；取新默认
    // 能力会把 image_in 写成显式 capabilities,随后在绑定解析中赢得兜底链
    // (评审 BLOCK #3)。v1 → deepseek 的入口是 models.custom + 官方域名识别。
    const normalized = normalizeConfig({
      schemaVersion: 1,
      defaultModel: 'custom',
      models: {
        custom: {
          baseUrl: 'https://api.deepseek.com',
          apiKey: 'sk-ds-legacy',
          model: 'deepseek-v4-pro',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    } as LegacyConfig);

    expect(normalized.defaultProvider).toBe('deepseek');
    const entry = normalized.models['deepseek-default'];
    expect(entry).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      capabilities: ['tools', 'thinking'],
    });
    expect(entry.capabilities).not.toContain('image_in');
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

  it('pins a schema-v1 Kimi config without a model to the still-served K2.7 generation', () => {
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
    // 原本 pin 的是裸 `kimi-k2.7`，但官方任何 endpoint 都没有这个 ID。
    // `kimi-for-coding` 就是官方的 Kimi K2.7 Code，既有效又不跨代升级用户。
    expect(normalized.models['kimi-default']).toMatchObject({
      provider: 'kimi',
      model: 'kimi-for-coding',
    });
    // kimi-for-coding 有自己的官方 contextLimit（262,144），但不得带 K3 的 reasoning 策略。
    // 只比 contextLimit 无法区分 —— K3 的值恰好相同。
    expect(normalized.models['kimi-default'].runtimeOptions?.reasoningEffort).toBeUndefined();
    const normalizedModel = normalized.models['kimi-default'];
    expect('runtimeConstraints' in normalizedModel ? normalizedModel.runtimeConstraints : undefined).toBeUndefined();
  });

  it('recognizes an explicit default HTTPS port in a schema-v1 Kimi endpoint', () => {
    const normalized = normalizeConfig({
      schemaVersion: 1,
      defaultModel: 'custom',
      models: {
        custom: {
          baseUrl: 'https://api.kimi.com:443/coding/v1',
          apiKey: 'sk-kimi',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    });

    expect(normalized.defaultProvider).toBe('kimi');
    expect(normalized.defaultModelId).toBe('kimi-default');
    expect(normalized.models['kimi-default']).toMatchObject({
      provider: 'kimi',
      model: 'kimi-for-coding',
    });
    // 保留旧 alias 的 256K，不自动启用新 reasoning 默认。
    expect(normalized.models['kimi-default'].runtimeOptions).toEqual({ contextLimit: 262_144 });
    const normalizedModel = normalized.models['kimi-default'];
    expect('runtimeConstraints' in normalizedModel ? normalizedModel.runtimeConstraints : undefined).toBeUndefined();
  });

  it('detects MiniMax from both the legacy and the current official host', () => {
    for (const baseUrl of [
      'https://api.minimax.chat/v1',   // 存量配置里的旧域名
      'https://api.minimax.io/v1',     // 官方现行（国际）
      'https://api.minimaxi.com/v1',   // 官方现行（国内）
    ]) {
      const normalized = normalizeConfig({
        schemaVersion: 1,
        defaultModel: 'custom',
        models: { custom: { baseUrl, apiKey: 'sk-mm' } },
        defaultMode: 'interactive',
        channels: {},
      });

      expect(normalized.defaultProvider, baseUrl).toBe('minimax');
    }
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

  it('does not copy K3 runtime options for a schema-v1 Kimi proxy endpoint', () => {
    const normalized = normalizeConfig({
      schemaVersion: 1,
      defaultModel: 'custom',
      models: {
        custom: {
          baseUrl: 'https://api.kimi.com/coding-proxy/v1',
          apiKey: 'sk-kimi',
          model: 'k3',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    });

    expect(normalized.defaultProvider).toBe('kimi');
    expect(normalized.models['kimi-default']).toMatchObject({
      provider: 'kimi',
      model: 'k3',
      label: 'Kimi K3',
    });
    // 非官方 endpoint 上的 K3 完全不得拿到 catalog runtimeOptions —— 包括 contextLimit。
    // 这条不能弱化成「只是不带 reasoningEffort」。
    expect(normalized.models['kimi-default'].runtimeOptions).toBeUndefined();
    const normalizedModel = normalized.models['kimi-default'];
    expect('runtimeConstraints' in normalizedModel ? normalizedModel.runtimeConstraints : undefined).toBeUndefined();
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


describe('master compatibility: legacy Kimi and o3 保持不变', () => {
  it.each(['https://api.kimi.com/coding/v1', 'https://api.kimi.com:443/coding/v1'])('preserves all implicit legacy Kimi metadata at %s', baseUrl => {
    const input: LegacyConfig = { schemaVersion: 1, defaultModel: 'custom', models: { custom: { apiKey: 'fixture', baseUrl } }, defaultMode: 'interactive', channels: {} };
    const normalized = normalizeConfig(input);
    expect(normalized.models['kimi-default']).toEqual({ provider: 'kimi', model: 'kimi-for-coding', label: 'Kimi for Coding', capabilities: ['tools', 'thinking'], runtimeOptions: { contextLimit: 262_144 } });
    const binding = resolveRuntimeModelBinding(input);
    expect(binding.runtimeOptions).toEqual({ contextLimit: 262_144 });
    expect(binding.capabilities).toEqual(['tools', 'thinking']);
  });
  it('keeps o3 master normalized metadata including the absence of thinking', () => {
    const input: LegacyConfig = { schemaVersion: 1, defaultModel: 'openai', models: { openai: { apiKey: 'fixture', model: 'o3' } }, defaultMode: 'interactive', channels: {} };
    expect(normalizeConfig(input).models['openai-default']).toEqual({ provider: 'openai', model: 'o3', label: 'GPT-4o', capabilities: ['tools'] });
    expect(resolveRuntimeModelBinding(input)).toMatchObject({ wireModel: 'o3', capabilities: ['tools'], runtimeOptions: { contextLimit: 200_000 } });
  });
  it.each([undefined, { contextLimit: 131_072 }, { contextLimit: 524_288, reasoningEffort: 'max' as const }])('schema2 saved Kimi 保持不变: saved fields retained and master runtime defaults for %j', runtimeOptions => {
    const input = { schemaVersion: 2 as const, defaultProvider: 'kimi', defaultModelId: 'saved', providers: { kimi: { type: 'first_party' as const, protocol: 'openai_legacy' as const, apiKey: 'fixture', baseUrl: 'https://api.kimi.com/coding/v1' } }, models: { saved: { provider: 'kimi', model: 'kimi-for-coding', label: 'Saved label', capabilities: ['tools'], ...(runtimeOptions ? { runtimeOptions } : {}) } }, defaultMode: 'interactive' as const, channels: {} };
    const before = structuredClone(input);
    expect(normalizeConfig(input).models).toEqual(input.models);
    // master ignores custom alias options; forwarding them is deferred to issue195.
    expect(resolveRuntimeModelBinding(input).runtimeOptions).toEqual({ contextLimit: 262_144 });
    expect(input).toEqual(before);
  });
  it.each([
    { capabilities: undefined, baseUrl: 'https://api.kimi.com/coding/v1', protocol: 'openai_legacy' as const },
    { capabilities: ['tools', 'thinking'], baseUrl: 'https://api.kimi.com:443/coding/v1/', protocol: 'openai_legacy' as const },
    { capabilities: ['tools'], baseUrl: 'https://legacy.example/v1', protocol: 'openai_legacy' as const },
    { capabilities: ['tools'], baseUrl: 'https://api.kimi.com/coding/v1', protocol: 'openai_responses' as const },
  ])('ignores old alias custom options across saved metadata and transports: %j', ({ capabilities, baseUrl, protocol }) => {
    const input = { schemaVersion: 2 as const, defaultProvider: 'kimi', defaultModelId: 'saved', providers: { kimi: { type: 'first_party' as const, protocol, apiKey: 'fixture', baseUrl } }, models: { saved: { provider: 'kimi', model: 'kimi-for-coding', capabilities, runtimeOptions: { contextLimit: 524_288, reasoningEffort: 'max' as const } } }, defaultMode: 'interactive' as const, channels: {} };
    const before = structuredClone(input);
    expect(normalizeConfig(input).models).toEqual(input.models);
    expect(resolveRuntimeModelBinding(input).runtimeOptions).toEqual({ contextLimit: 262_144 });
    expect(input).toEqual(before);
  });
});


describe('saved o3 configuration', () => {
  it('preserves explicit schema2 metadata and options without provider-default capability inheritance', () => {
    const input = { schemaVersion: 2 as const, defaultProvider: 'openai', defaultModelId: 'saved', providers: { openai: { type: 'first_party' as const, protocol: 'openai_legacy' as const, apiKey: 'fixture' } }, models: { saved: { provider: 'openai', model: 'o3', label: 'My o3', capabilities: ['tools'], runtimeOptions: { contextLimit: 64_000 } } }, defaultMode: 'interactive' as const, channels: {} };
    const before = structuredClone(input);
    expect(normalizeConfig(input).models).toEqual(input.models);
    expect(resolveRuntimeModelBinding(input)).toMatchObject({ capabilities: ['tools'], runtimeOptions: { contextLimit: 64_000 } });
    expect(input).toEqual(before);
  });
});


describe('new Kimi catalog selection', () => {
  it('retains the explicitly selected K2.8 catalog 1M/high options', () => {
    const variant = getProviderProfile('kimi')!.availableModels!.find(model => model.model === 'kimi-for-coding')!;
    const input = { schemaVersion: 2 as const, defaultProvider: 'kimi', defaultModelId: 'selected', providers: { kimi: { type: 'first_party' as const, protocol: 'openai_legacy' as const, apiKey: 'fixture', baseUrl: 'https://api.kimi.com/coding/v1' } }, models: { selected: { provider: 'kimi', model: variant.model, label: variant.label, capabilities: [...variant.capabilities!], runtimeOptions: { ...variant.runtimeOptions } } }, defaultMode: 'interactive' as const, channels: {} };
    const before = structuredClone(input);
    expect(resolveRuntimeModelBinding(input).runtimeOptions).toEqual({ contextLimit: 1_048_576, reasoningEffort: 'high' });
    expect(input).toEqual(before);
    const unsupported = structuredClone(input);
    unsupported.providers.kimi.baseUrl = 'https://legacy.example/v1';
    unsupported.models.selected.runtimeOptions = { contextLimit: 524_288, reasoningEffort: 'max' };
    expect(resolveRuntimeModelBinding(unsupported)).not.toHaveProperty('runtimeOptions');
  });
});
