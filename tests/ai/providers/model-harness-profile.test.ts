import { describe, expect, it } from 'vitest';
import {
  resolveKimiHarnessFeatureFlags,
  resolveModelHarnessProfile,
  type AdapterBindingIdentity,
} from '../../../src/ai/providers/model-harness-profile.js';

describe('resolveModelHarnessProfile', () => {
  const identity: AdapterBindingIdentity = {
    providerId: 'kimi',
    providerType: 'first_party',
    protocol: 'openai_legacy',
    canonicalBaseUrl: 'https://api.kimi.com/coding/v1',
    wireModel: 'k3',
    capabilities: ['tools', 'thinking'],
  };

  it('selects the strict Kimi K3 coding profile for the exact first-party binding', () => {
    expect(resolveModelHarnessProfile(identity).id).toBe('kimi-k3-coding-openai');
    expect(resolveModelHarnessProfile({ ...identity, providerType: 'custom' }).id)
      .toBe('generic-openai');
  });

  it.each([
    ['custom Kimi provider', { providerType: 'custom' }],
    ['Kimi K2.7 model', { wireModel: 'kimi-k2.7' }],
    ['wrong protocol', { protocol: 'openai_responses' }],
    ['lookalike host', { canonicalBaseUrl: 'https://api.kimi.com.evil.example/coding/v1' }],
    ['explicit port', { canonicalBaseUrl: 'https://api.kimi.com:443/coding/v1' }],
    ['query string', { canonicalBaseUrl: 'https://api.kimi.com/coding/v1?mode=test' }],
    ['fragment', { canonicalBaseUrl: 'https://api.kimi.com/coding/v1#test' }],
    ['userinfo', { canonicalBaseUrl: 'https://user@api.kimi.com/coding/v1' }],
    ['missing URL', { canonicalBaseUrl: undefined }],
    ['invalid URL', { canonicalBaseUrl: 'not a URL' }],
  ] as const)('uses the generic profile for %s', (_label, override) => {
    expect(resolveModelHarnessProfile({ ...identity, ...override } as AdapterBindingIdentity).id)
      .toBe('generic-openai');
  });
});

describe('resolveKimiHarnessFeatureFlags', () => {
  it('enables stable normalization flags and keeps experimental flags opt-in', () => {
    const flags = resolveKimiHarnessFeatureFlags({});

    expect(flags).toEqual({
      normalizeToolSchema: true,
      normalizeUsage: true,
      omitEmptyAssistantContent: true,
      promptCacheKey: false,
      preservedThinking: false,
    });
    expect(Object.isFrozen(flags)).toBe(true);
  });

  it('enables experimental flags only for an exact value of 1', () => {
    expect(resolveKimiHarnessFeatureFlags({
      XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE: '1',
      XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
    })).toMatchObject({
      promptCacheKey: true,
      preservedThinking: true,
    });

    expect(resolveKimiHarnessFeatureFlags({
      XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE: 'true',
      XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: 'yes',
    })).toMatchObject({
      promptCacheKey: false,
      preservedThinking: false,
    });
  });
});
