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
