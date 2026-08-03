import { describe, expect, it } from 'vitest';
import { findCatalogModel, getProviderProfile, listProviderProfiles } from '../../../src/ai/providers/registry.js';
import * as registry from '../../../src/ai/providers/registry.js';
import type { ProviderModelVariant, ProviderProfile } from '../../../src/ai/providers/types.js';

function resolveVariant(profile: ProviderProfile, wireModel: string): ProviderModelVariant | undefined {
  return (registry as unknown as {
    resolveProviderModelVariant(
      inputProfile: ProviderProfile,
      inputWireModel: string,
    ): ProviderModelVariant | undefined;
  }).resolveProviderModelVariant(profile, wireModel);
}

describe('getProviderProfile', () => {
  it('returns known first-party profiles with explicit protocols', () => {
    expect(getProviderProfile('kimi')).toMatchObject({
      protocol: 'openai_legacy',
    });
    expect(getProviderProfile('anthropic')).toMatchObject({
      protocol: 'anthropic',
    });
    expect(getProviderProfile('gemini')).toBeTruthy();
  });

  it('returns undefined for unknown providers', () => {
    expect(getProviderProfile('unknown')).toBeUndefined();
    expect(getProviderProfile('')).toBeUndefined();
  });

  it('registers Kimi K3 as the stable default with runtime policy metadata', () => {
    const profile = getProviderProfile('kimi');

    expect(profile?.defaultModel).toMatchObject({
      modelId: 'kimi-default',
      model: 'k3',
      label: 'Kimi K3',
      runtimeOptions: {
        contextLimit: 262_144,
        reasoningEffort: 'high',
      },
      runtimeConstraints: {
        maxContextLimit: 1_048_576,
        reasoningEfforts: ['low', 'high', 'max'],
      },
    });

    const k3 = profile?.availableModels?.find((variant) => variant.modelId === 'kimi-k3');
    expect(k3).toMatchObject({
      model: 'k3',
      label: 'Kimi K3',
      runtimeOptions: {
        contextLimit: 262_144,
        reasoningEffort: 'high',
      },
      runtimeConstraints: {
        maxContextLimit: 1_048_576,
        reasoningEfforts: ['low', 'high', 'max'],
      },
    });
    expect(k3?.runtimeOptions).not.toBe(profile?.defaultModel.runtimeOptions);
    expect(k3?.runtimeConstraints).not.toBe(profile?.defaultModel.runtimeConstraints);
    expect(k3?.runtimeConstraints?.reasoningEfforts).not.toBe(
      profile?.defaultModel.runtimeConstraints?.reasoningEfforts,
    );

    expect(profile?.availableModels).toContainEqual(expect.objectContaining({
      modelId: 'kimi-k3-256k',
      model: 'k3-256k',
      label: 'Kimi K3 256K',
      runtimeOptions: {
        contextLimit: 262_144,
        reasoningEffort: 'high',
      },
    }));
  });

  it('keeps K2.6 and K2.5 free of the K3 reasoning policy', () => {
    const variants = getProviderProfile('kimi')?.availableModels ?? [];

    for (const modelId of ['kimi-k2.6', 'kimi-k2.5']) {
      const variant = variants.find((candidate) => candidate.modelId === modelId);
      expect(variant, modelId).toBeDefined();
      // 它们有自己的官方 contextLimit（262,144），但不该带 K3 的 reasoning 策略。
      // 注意不能只比 contextLimit —— K3 的值恰好也是 262,144。
      expect(variant?.runtimeOptions?.reasoningEffort, modelId).toBeUndefined();
      expect(variant?.runtimeConstraints, modelId).toBeUndefined();
    }
  });

  it('treats equivalent duplicate wire variants as deterministic despite label and modelId differences', () => {
    const profile: ProviderProfile = {
      id: 'kimi',
      label: 'Kimi',
      protocol: 'openai_legacy',
      envPrefixes: ['KIMI'],
      defaultModel: {
        modelId: 'z-default',
        model: 'same-wire',
        label: 'Default label',
        capabilities: ['thinking', 'tools'],
        runtimeOptions: { reasoningEffort: 'high', contextLimit: 262_144 },
        runtimeConstraints: {
          reasoningEfforts: ['max', 'high', 'low'],
          maxContextLimit: 1_048_576,
        },
      },
      availableModels: [{
        modelId: 'a-alias',
        model: 'same-wire',
        label: 'Alias label',
        capabilities: ['tools', 'thinking'],
        runtimeOptions: { contextLimit: 262_144, reasoningEffort: 'high' },
        runtimeConstraints: {
          maxContextLimit: 1_048_576,
          reasoningEfforts: ['low', 'high', 'max'],
        },
      }],
    };

    expect(resolveVariant(profile, 'same-wire')).toMatchObject({
      model: 'same-wire',
      modelId: 'a-alias',
    });
  });

  it('throws a local coded error for ambiguous duplicate wire metadata', () => {
    const profile: ProviderProfile = {
      id: 'kimi',
      label: 'Kimi',
      protocol: 'openai_legacy',
      envPrefixes: ['KIMI'],
      defaultModel: {
        modelId: 'default',
        model: 'ambiguous-wire',
        label: 'Default',
        capabilities: ['tools'],
      },
      availableModels: [{
        modelId: 'other',
        model: 'ambiguous-wire',
        label: 'Other',
        capabilities: ['tools', 'thinking'],
      }],
    };

    expect(() => resolveVariant(profile, 'ambiguous-wire')).toThrowError(
      expect.objectContaining({ code: 'MODEL_VARIANT_AMBIGUOUS' }),
    );
  });
});

describe('listProviderProfiles', () => {
  const ALL_PROVIDER_IDS = ['openai', 'anthropic', 'kimi', 'deepseek', 'glm', 'minimax', 'gemini'];

  it('returns all 7 first-party providers', () => {
    const profiles = listProviderProfiles();
    expect(profiles).toHaveLength(7);
    const ids = profiles.map(p => p.id);
    for (const id of ALL_PROVIDER_IDS) {
      expect(ids).toContain(id);
    }
  });

  it('every provider has a baseUrl', () => {
    const profiles = listProviderProfiles();
    for (const profile of profiles) {
      expect(profile.baseUrl, `${profile.id} should have baseUrl`).toBeTruthy();
      expect(profile.baseUrl).toMatch(/^https:\/\//);
    }
  });

  it('every provider has availableModels with at least one entry', () => {
    const profiles = listProviderProfiles();
    for (const profile of profiles) {
      expect(profile.availableModels, `${profile.id} should have availableModels`).toBeDefined();
      expect(profile.availableModels!.length, `${profile.id} should have at least 1 model`).toBeGreaterThanOrEqual(1);
      for (const m of profile.availableModels!) {
        expect(m.modelId).toBeTruthy();
        expect(m.model).toBeTruthy();
        expect(m.label).toBeTruthy();
      }
    }
  });

  it('every provider has a valid defaultModel', () => {
    const profiles = listProviderProfiles();
    for (const profile of profiles) {
      expect(profile.defaultModel.modelId).toBeTruthy();
      expect(profile.defaultModel.model).toBeTruthy();
      expect(profile.defaultModel.label).toBeTruthy();
    }
  });

  it('expected base URLs match known values', () => {
    const expected: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com',
      kimi: 'https://api.kimi.com/coding/v1',
      deepseek: 'https://api.deepseek.com/v1',
      glm: 'https://open.bigmodel.cn/api/paas/v4',
      minimax: 'https://api.minimax.io/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
    };
    for (const [id, url] of Object.entries(expected)) {
      const profile = getProviderProfile(id);
      expect(profile!.baseUrl).toBe(url);
    }
  });
});

describe('catalog only lists models the providers actually serve', () => {
  // 每条都对应一次官方文档查证（2026-08-03）。目录里留着官方不存在或已下线的
  // 模型 ID，用户从选择器里选中就会拿到 404，比窗口值错更直接。
  it('drops Anthropic wire names that do not exist in the official model list', () => {
    const wires = (getProviderProfile('anthropic')?.availableModels ?? []).map((v) => v.model);

    // Sonnet 线官方只有 5 / 4-6 / 4-5，没有 4-7
    expect(wires).not.toContain('claude-sonnet-4-7');
    // Haiku 线官方当前只有 4-5
    expect(wires).not.toContain('claude-haiku-4-6');
    expect(wires).toContain('claude-haiku-4-5');
  });

  it('drops Kimi wire names that are retired or never existed', () => {
    const wires = (getProviderProfile('kimi')?.availableModels ?? []).map((v) => v.model);

    // 官方开放平台是 kimi-k2.7-code，裸 kimi-k2.7 在任何 endpoint 都不存在
    expect(wires).not.toContain('kimi-k2.7');
    // kimi-k2 全系列已于 2026-05-25 下线
    expect(wires).not.toContain('kimi-k2-thinking');
  });

  it('drops MiniMax wire names removed from the official model enum', () => {
    const profile = getProviderProfile('minimax');
    const wires = (profile?.availableModels ?? []).map((v) => v.model);

    expect(wires).not.toContain('MiniMax-Text-01');
    expect(wires).not.toContain('MiniMax-M1');
    expect(profile?.availableModels?.length).toBeGreaterThanOrEqual(1);
  });

  it('points MiniMax at the current official base URL', () => {
    expect(getProviderProfile('minimax')?.baseUrl).toBe('https://api.minimax.io/v1');
  });

  it('does not claim image input for DeepSeek, which officially rejects it', () => {
    const profile = getProviderProfile('deepseek');
    const variants = [profile!.defaultModel, ...(profile!.availableModels ?? [])];

    for (const variant of variants) {
      // 官方三处独立说明不支持图片输入（Anthropic 兼容表 / Responses API / chat 参考）
      expect(variant.capabilities, variant.modelId).not.toContain('image_in');
      // 官方为默认开启思考模式
      expect(variant.capabilities, variant.modelId).toContain('thinking');
    }
  });
});

describe('GLM catalog context windows', () => {
  // 数值来自 https://docs.bigmodel.cn/cn/guide/start/model-overview 逐个查证。
  const OFFICIAL_CONTEXT_LIMITS: Record<string, number> = {
    'glm-5.2': 1_000_000,
    'glm-5.1': 200_000,
    'glm-5': 200_000,
    'glm-5-turbo': 200_000,
    'glm-4.7': 200_000,
    'glm-4.5': 128_000,
  };

  it('declares an explicit contextLimit for every GLM variant', () => {
    const profile = getProviderProfile('glm');
    const variants = [profile!.defaultModel, ...(profile!.availableModels ?? [])];

    for (const variant of variants) {
      expect(
        variant.runtimeOptions?.contextLimit,
        `${variant.modelId} should declare contextLimit explicitly`,
      ).toBeTypeOf('number');
    }
  });

  it('matches the officially published window for each GLM version', () => {
    const profile = getProviderProfile('glm');

    for (const [modelId, contextLimit] of Object.entries(OFFICIAL_CONTEXT_LIMITS)) {
      const variant = profile!.availableModels?.find((item) => item.modelId === modelId);
      expect(variant, modelId).toBeDefined();
      expect(variant?.runtimeOptions?.contextLimit, modelId).toBe(contextLimit);
    }
  });

  it('keeps glm-default byte-identical to the availableModels entry sharing its wire model', () => {
    const profile = getProviderProfile('glm');
    const twin = profile!.availableModels?.find(
      (item) => item.model === profile!.defaultModel.model,
    );

    expect(twin).toBeDefined();
    expect(profile!.defaultModel.runtimeOptions).toEqual(twin?.runtimeOptions);
    expect(profile!.defaultModel.capabilities).toEqual(twin?.capabilities);
  });
});

describe('catalog metadata invariants', () => {
  // 结构性断言：与具体模型无关，因此给任何 provider 加模型都不需要改本测试。
  //
  // 若未来需要「同一 wireModel 暴露多个预设」（例如 low / high 两档
  // reasoningEffort），正确做法是改 resolveProviderModelVariant 的消歧键，
  // 或让两个预设使用不同的 wireModel —— 不要放宽本守卫。
  it('never lets one provider expose the same wire model with divergent metadata', () => {
    for (const profile of listProviderProfiles()) {
      const byWire = new Map<string, ProviderModelVariant[]>();
      for (const variant of [profile.defaultModel, ...(profile.availableModels ?? [])]) {
        const bucket = byWire.get(variant.model) ?? [];
        bucket.push(variant);
        byWire.set(variant.model, bucket);
      }

      for (const [wireModel, variants] of byWire) {
        if (variants.length < 2) continue;
        expect(
          () => resolveVariant(profile, wireModel),
          `${profile.id}/${wireModel} duplicates must agree on metadata`,
        ).not.toThrow();
      }
    }
  });

  it('names the conflicting model ids and fields when duplicates disagree', () => {
    const profile: ProviderProfile = {
      id: 'glm',
      label: 'GLM',
      protocol: 'openai_legacy',
      envPrefixes: ['GLM'],
      defaultModel: {
        modelId: 'glm-default',
        model: 'GLM-9',
        label: 'GLM 9',
        capabilities: ['tools'],
        runtimeOptions: { contextLimit: 1_000_000 },
      },
      availableModels: [{
        modelId: 'glm-9',
        model: 'GLM-9',
        label: 'GLM 9',
        capabilities: ['tools'],
        // 故意漏填 runtimeOptions —— 这正是 §2.3 描述的漏填场景
      }],
    };

    let captured: Error | undefined;
    try {
      resolveVariant(profile, 'GLM-9');
    } catch (error) {
      captured = error as Error;
    }

    expect(captured).toBeDefined();
    expect(captured).toMatchObject({ code: 'MODEL_VARIANT_AMBIGUOUS' });
    // 没有这些信息，守卫在 CI 变红后还要人工逐行 diff registry。
    expect(captured?.message).toContain('glm-default');
    expect(captured?.message).toContain('glm-9');
    expect(captured?.message).toContain('runtimeOptions');
  });
});

describe('findCatalogModel', () => {
  const profile: ProviderProfile = {
    id: 'glm',
    label: 'GLM',
    protocol: 'openai_legacy',
    envPrefixes: ['GLM'],
    defaultModel: {
      modelId: 'glm-default',
      model: 'GLM-5.2',
      label: 'GLM 5.2',
      capabilities: ['tools'],
      runtimeOptions: { contextLimit: 1_000_000 },
    },
    availableModels: [
      {
        modelId: 'glm-5.2',
        model: 'GLM-5.2',
        label: 'GLM 5.2',
        capabilities: ['tools'],
        runtimeOptions: { contextLimit: 1_000_000 },
      },
      {
        modelId: 'glm-4.5',
        model: 'glm-4.5',
        label: 'GLM 4.5',
        capabilities: ['tools'],
        runtimeOptions: { contextLimit: 128_000 },
      },
    ],
  };

  it('prefers an exact modelId and wire model match', () => {
    expect(findCatalogModel(profile, 'glm-4.5', 'glm-4.5')).toMatchObject({
      modelId: 'glm-4.5',
    });
  });

  it('recovers metadata for a synthesized modelId by unique wire model', () => {
    // Desktop 写入的是 `glm-glm-5.2`，CLI 写入的是 `glm-glm-5-2`，两者都不等于
    // catalog 的 `glm-5.2`。回退让这些存量配置不必迁移就能拿到正确窗口。
    expect(findCatalogModel(profile, 'glm-glm-5.2', 'GLM-5.2')?.runtimeOptions)
      .toEqual({ contextLimit: 1_000_000 });
    expect(findCatalogModel(profile, 'glm-glm-5-2', 'GLM-5.2')?.runtimeOptions)
      .toEqual({ contextLimit: 1_000_000 });
  });

  it('returns undefined instead of throwing when duplicate wire metadata disagrees', () => {
    const divergent: ProviderProfile = {
      ...profile,
      availableModels: [{
        modelId: 'glm-5.2',
        model: 'GLM-5.2',
        label: 'GLM 5.2',
        capabilities: ['tools'],
        runtimeOptions: { contextLimit: 200_000 },
      }],
    };

    // 运行时主路径（control-plane R1）不能因为 registry 数据不一致而抛错。
    expect(() => findCatalogModel(divergent, 'glm-glm-5.2', 'GLM-5.2')).not.toThrow();
    expect(findCatalogModel(divergent, 'glm-glm-5.2', 'GLM-5.2')).toBeUndefined();
  });

  it('returns undefined for a missing profile or an unknown wire model', () => {
    expect(findCatalogModel(undefined, 'glm-5.2', 'GLM-5.2')).toBeUndefined();
    expect(findCatalogModel(profile, 'glm-9', 'GLM-9')).toBeUndefined();
  });
});

describe('official context windows per provider', () => {
  // 每个数字都对应一次官方文档查证（2026-08-03）。来源见各 provider 注释。
  const OFFICIAL: Record<string, Record<string, number>> = {
    // https://developers.openai.com/api/docs/models/<model>
    openai: {
      'openai-gpt-5.5': 1_050_000,
      'openai-gpt-5': 400_000,
      'openai-gpt-4o': 128_000,
      'openai-gpt-4.1': 1_047_576,
      'openai-o4-mini': 200_000,
      'openai-o3': 200_000,
    },
    // https://api-docs.deepseek.com/quick_start/pricing/
    deepseek: {
      'deepseek-v4-pro': 1_000_000,
      'deepseek-v4-flash': 1_000_000,
    },
    // https://platform.minimax.io/docs/guides/text-generation
    minimax: {
      'minimax-m3': 1_000_000,
    },
    // https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
    gemini: {
      'gemini-2.5-pro': 1_048_576,
      'gemini-2.5-flash': 1_048_576,
    },
    // https://platform.kimi.com/docs/pricing/chat-k26.md 等定价页给出精确 262,144
    kimi: {
      'kimi-k2.6': 262_144,
      'kimi-k2.5': 262_144,
      'kimi-for-coding': 262_144,
    },
  };

  for (const [providerId, models] of Object.entries(OFFICIAL)) {
    it(`matches the published window for every filled ${providerId} model`, () => {
      const variants = getProviderProfile(providerId)?.availableModels ?? [];
      for (const [modelId, contextLimit] of Object.entries(models)) {
        const variant = variants.find((candidate) => candidate.modelId === modelId);
        expect(variant, `${providerId}/${modelId}`).toBeDefined();
        expect(variant?.runtimeOptions?.contextLimit, `${providerId}/${modelId}`).toBe(contextLimit);
      }
    });
  }

  it('keeps Kimi K3 on its tiered default instead of the 1M ceiling', () => {
    // 官方按订阅档位分档（Moderato 256K / Allegretto+ 1M），当前建模是
    // 「保守默认 + 用户可上调」，与档位现实吻合，本轮不动。
    const variants = getProviderProfile('kimi')?.availableModels ?? [];
    const k3 = variants.find((candidate) => candidate.modelId === 'kimi-k3');
    expect(k3?.runtimeOptions?.contextLimit).toBe(262_144);
    expect(k3?.runtimeConstraints?.maxContextLimit).toBe(1_048_576);
  });

  it('deliberately leaves Anthropic windows unfilled until the estimator is trustworthy', () => {
    // 这不是遗漏。Anthropic 是唯一严格校验 input + max_tokens ≤ window 的协议，
    // 而 estimateTokens 是 chars/4：对中文的偏差尚未量化，Claude 4.7 还换了
    // tokenizer（同文本多约 30% token）。在估算器可信之前把 Sonnet 从 200K
    // 抬到官方的 1M，会把安全边际同比放大 5 倍。
    const profile = getProviderProfile('anthropic');
    for (const variant of [profile!.defaultModel, ...(profile!.availableModels ?? [])]) {
      expect(variant.runtimeOptions?.contextLimit, variant.modelId).toBeUndefined();
    }
  });
});
