import { describe, expect, it } from 'vitest';
import { getProviderProfile } from '../../../src/ai/providers/registry.js';

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
});
