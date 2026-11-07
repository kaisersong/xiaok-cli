import { listProviderProfiles } from '../../../src/ai/providers/registry.js';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { currentRecommendedModelIds, loadCurrentRecommendedModelIds } from '../../renderer/src/lib/model-recommendations';

const desktop = vi.hoisted(() => ({ getModelConfig: vi.fn() }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => desktop }));

describe('automatic model recommendations', () => {
  afterEach(() => vi.resetAllMocks());
  it('loads official providerProfiles from the Desktop snapshot and ignores saved legacy models', async () => {
    desktop.getModelConfig.mockResolvedValue({
      providers: [{ id: 'openai', type: 'first_party', protocol: 'openai_legacy' }],
      models: [{ id: 'saved', provider: 'openai', model: 'gpt-4o' }],
      providerProfiles: listProviderProfiles().map(profile => ({ ...profile, defaultModel: profile.defaultModel.model })),
    });
    const recommended = await loadCurrentRecommendedModelIds('openai');
    expect([...recommended]).toEqual(['gpt-5.5']);
    expect(recommended.has('gpt-4o')).toBe(false);
    expect(desktop.getModelConfig).toHaveBeenCalledOnce();
  });
  it('requires manual selection when the main catalog cannot be read', async () => {
    desktop.getModelConfig.mockRejectedValue(new Error('unavailable'));
    expect(await loadCurrentRecommendedModelIds()).toEqual(new Set());
  });
  it('shares the current official catalog and requires manual selection for unknown models', () => {
    const profiles = listProviderProfiles().map(profile => ({ ...profile, defaultModel: profile.defaultModel.model }));
    const recommended = currentRecommendedModelIds(profiles);
    expect(currentRecommendedModelIds(profiles, 'openai').has('gpt-5.5')).toBe(true);
    expect(currentRecommendedModelIds(profiles, 'anthropic').has('claude-sonnet-4-6')).toBe(true);
    expect(currentRecommendedModelIds(profiles, 'gemini').has('gemini-3.1-pro-preview')).toBe(true);
    for (const model of ['gpt-4o', 'gpt-4o-mini', 'claude-3-haiku', 'gemini-1.5-pro', 'gemini-2.0-flash', 'my-custom-model']) {
      expect(recommended.has(model), model).toBe(false);
    }
    expect(currentRecommendedModelIds(profiles, 'gemini').has('gpt-5.5')).toBe(false);
    expect(recommended.has('gpt-5.5-pretend')).toBe(false);
  });
});
