import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG_YEAR, getProviderProfile, getProviderModelVariant, listProviderProfiles } from '../../../src/ai/providers/registry.js';
import { resolveRuntimeModelBinding } from '../../../src/ai/providers/control-plane.js';
import { normalizeConfig } from '../../../src/ai/providers/normalize.js';
import { buildModelOptions } from '../../../src/ui/model-selector.js';
import { getProviderLoginPlans } from '../../../src/ai/providers/login-plans.js';
import type { ConfigV2Input } from '../../../src/types.js';

const retired = [
  ['openai', 'gpt-4o', 128_000], ['openai', 'gpt-4.1', 1_047_576],
  ['openai', 'gpt-5', 400_000], ['openai', 'o3', 200_000], ['openai', 'o4-mini', 200_000],
  ['anthropic', 'claude-haiku-4-5', undefined],
  ['glm', 'GLM-4.7', 200_000], ['glm', 'glm-4.5', 128_000],
  ['gemini', 'gemini-2.5-pro', 1_048_576], ['gemini', 'gemini-2.5-flash-preview-05-20', 1_048_576],
] as const;

describe('current-year built-in catalog', () => {
  it('offers only the explicitly maintained support year, including defaults and login plans', () => {
    expect(MODEL_CATALOG_YEAR).toBe(2026);
    for (const profile of listProviderProfiles()) {
      for (const model of [profile.defaultModel, ...(profile.availableModels ?? []), ...getProviderLoginPlans(profile.id).map(p => p.defaultModel)]) {
        expect(model.releaseYear, `${profile.id}/${model.model}`).toBe(MODEL_CATALOG_YEAR);
      }
    }
    expect(getProviderProfile('openai')?.defaultModel.model).toBe('gpt-5.5');
    expect(getProviderProfile('gemini')).toMatchObject({ protocol: 'openai_legacy', defaultModel: { model: 'gemini-3.1-pro-preview' } });
  });
  it.each(retired)('keeps %s/%s metadata and an existing binding without recommending it', (providerId, wire, contextLimit) => {
    const profile = getProviderProfile(providerId)!;
    expect(profile.availableModels?.some(m => m.model === wire)).toBe(false);
    expect(profile.defaultModel.model).not.toBe(wire);
    const variant = getProviderModelVariant(providerId, wire)!;
    expect(variant).toBeDefined();
    expect(variant.runtimeOptions?.contextLimit).toBe(contextLimit);
    const input: ConfigV2Input = { schemaVersion: 2, defaultProvider: providerId, defaultModelId: 'saved', providers: { [providerId]: { type: 'first_party', protocol: providerId === 'gemini' ? 'openai_responses' : profile.protocol, apiKey: 'fixture', baseUrl: profile.baseUrl } }, models: { saved: { provider: providerId, model: wire, label: 'My saved model' } }, defaultMode: 'interactive', channels: {} };
    const before = structuredClone(input);
    const binding = resolveRuntimeModelBinding(input);
    expect(binding.wireModel).toBe(wire);
    expect(binding.runtimeOptions?.contextLimit).toBe(contextLimit);
    expect(binding.capabilities).toEqual(variant.capabilities);
    expect(input).toEqual(before);
    const options = buildModelOptions(normalizeConfig(input));
    expect(options.filter(m => m.model === wire)).toEqual([expect.objectContaining({ id: 'saved', label: 'My saved model' })]);
  });
  it('does not upgrade schema-v1 implicit or explicit OpenAI models', () => {
    for (const model of [undefined, 'gpt-4o', 'gpt-5']) {
      const input = { schemaVersion: 1 as const, defaultModel: 'openai' as const, models: { openai: { apiKey: 'fixture', ...(model ? { model } : {}) } }, defaultMode: 'interactive' as const, channels: {} };
      const binding = resolveRuntimeModelBinding(input);
      expect(binding.wireModel).toBe(model ?? 'gpt-4o');
      expect(binding.runtimeOptions?.contextLimit).toBe(model === 'gpt-5' ? 400_000 : 128_000);
    }
  });
  it('preserves the implicit schema-v1 Gemini model and protocol', () => {
    const binding = resolveRuntimeModelBinding({ schemaVersion: 1, defaultModel: 'custom', models: { custom: { apiKey: 'fixture', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' } }, defaultMode: 'interactive', channels: {} });
    expect(binding).toMatchObject({ wireModel: 'gemini-2.5-pro', protocol: 'openai_responses', runtimeOptions: { contextLimit: 1_048_576 } });
  });
});
