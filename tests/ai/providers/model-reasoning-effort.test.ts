import { describe, expect, it } from 'vitest';
import { getSupportedModelReasoningEfforts, getDefaultModelReasoningEffort } from '../../../src/ai/providers/model-reasoning-effort.js';

describe('model reasoning policy', () => {
  it.each([
    ['kimi', 'k3', 'https://api.kimi.com/coding/v1', ['low', 'high', 'max'], 'high'],
    ['glm', 'GLM-5.3', 'https://open.bigmodel.cn/api/paas/v4', ['low', 'high', 'max'], 'high'],
    ['openai', 'gpt-5', 'https://api.openai.com/v1', ['minimal', 'low', 'medium', 'high'], 'medium'],
    ['openai', 'gpt-5.5', 'https://API.OPENAI.COM:443/v1/', ['none', 'low', 'medium', 'high', 'xhigh'], 'medium'],
  ] as const)('resolves native tiers and the middle default for %s/%s', (providerId, wireModel, baseUrl, tiers, middle) => {
    const efforts = getSupportedModelReasoningEfforts({ providerId, providerType: 'first_party', protocol: 'openai_legacy', wireModel, baseUrl });
    expect(efforts).toEqual(tiers);
    expect(getDefaultModelReasoningEffort(efforts)).toBe(middle);
  });

  it.each([
    { providerType: 'custom' as const },
    { protocol: 'openai_responses' as const },
    { wireModel: 'gpt-4o' },
    { baseUrl: 'https://proxy.example.com/v1' },
    { baseUrl: 'https://api.openai.com/v1?ignored=true' },
    { baseUrl: 'https://api.openai.com.evil.test/v1' },
  ])('exposes no unsupported effort for %j', (override) => {
    expect(getSupportedModelReasoningEfforts({ providerId: 'openai', providerType: 'first_party', protocol: 'openai_legacy', wireModel: 'gpt-5.5', baseUrl: 'https://api.openai.com/v1', ...override })).toEqual([]);
  });

  it('has no default when no effort is supported', () => {
    expect(getDefaultModelReasoningEffort([])).toBeUndefined();
  });
});
