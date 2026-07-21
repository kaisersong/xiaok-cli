import { describe, expect, it } from 'vitest';
import { getProviderProfile, listProviderProfiles } from '../../../src/ai/providers/registry.js';

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
  });

  it('keeps K2.7, K2.6, and K2.5 without K3 runtime options', () => {
    const variants = getProviderProfile('kimi')?.availableModels ?? [];

    for (const modelId of ['kimi-k2.7', 'kimi-k2.6', 'kimi-k2.5']) {
      const variant = variants.find((candidate) => candidate.modelId === modelId);
      expect(variant, modelId).toBeDefined();
      expect(variant?.runtimeOptions, modelId).toBeUndefined();
      expect(variant?.runtimeConstraints, modelId).toBeUndefined();
    }
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
      minimax: 'https://api.minimax.chat/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
    };
    for (const [id, url] of Object.entries(expected)) {
      const profile = getProviderProfile(id);
      expect(profile!.baseUrl).toBe(url);
    }
  });
});
