import { describe, expect, it } from 'vitest';
import { buildModelOptions } from '../../src/ui/model-selector.js';

describe('buildModelOptions', () => {
  it('lists every configured model entry instead of one model per provider', () => {
    const options = buildModelOptions({
      schemaVersion: 2,
      defaultProvider: 'kimi',
      defaultModelId: 'kimi-coding',
      providers: {
        kimi: {
          type: 'first_party',
          protocol: 'openai_legacy',
          apiKey: 'sk-kimi',
          baseUrl: 'https://api.kimi.com/coding/v1',
        },
      },
      models: {
        'kimi-coding': {
          provider: 'kimi',
          model: 'kimi-for-coding',
          label: 'Kimi Coding',
        },
        'kimi-k2-thinking': {
          provider: 'kimi',
          model: 'kimi-k2-thinking',
          label: 'Kimi K2 Thinking',
        },
      },
      defaultMode: 'interactive',
      channels: {},
    });

    expect(options.map((option) => option.id)).toEqual(['kimi-coding', 'kimi-k2-thinking']);
    expect(options.map((option) => option.label)).toEqual(['Kimi Coding', 'Kimi K2 Thinking']);
  });
});
