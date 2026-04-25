import { describe, expect, it } from 'vitest';
import { buildModelOptions, selectModel } from '../../src/ui/model-selector.js';
import { createTtyHarness } from '../support/tty.js';
import { waitFor } from '../support/wait-for.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';

const configFixture = {
  schemaVersion: 2 as const,
  defaultProvider: 'kimi',
  defaultModelId: 'kimi-coding',
  providers: {
    kimi: {
      type: 'first_party' as const,
      protocol: 'openai_legacy' as const,
      apiKey: 'sk-kimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
    },
  },
  models: {
    'kimi-coding': {
      provider: 'kimi',
      model: 'kimi-for-coding',
      label: 'Kimi Default',
    },
    'kimi-k2-thinking': {
      provider: 'kimi',
      model: 'kimi-k2-thinking',
      label: 'Kimi K2 Thinking',
    },
    'kimi-k2-fast': {
      provider: 'kimi',
      model: 'kimi-k2-fast',
      label: 'Kimi K2 Fast',
    },
  },
  defaultMode: 'interactive' as const,
  channels: {},
};

describe('buildModelOptions', () => {
  it('lists every configured model entry instead of one model per provider', () => {
    const options = buildModelOptions({
      ...configFixture,
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
    });

    expect(options.map((option) => option.id)).toEqual(['kimi-coding', 'kimi-k2-thinking']);
    expect(options.map((option) => option.label)).toEqual(['Kimi Coding', 'Kimi K2 Thinking']);
  });

  it('renders the model selector as a multi-line overlay above the footer when a repl renderer is active', async () => {
    const harness = createTtyHarness(60, 24);
    const renderer = new ReplRenderer(process.stdout);
    const scrollRegion = new ScrollRegionManager(process.stdout);

    try {
      scrollRegion.begin();
      scrollRegion.renderFooter({
        inputPrompt: 'Type your message...',
        statusLine: 'kimi-for-coding · 16% · master · xiaok-cli',
      });
      renderer.setScrollRegion(scrollRegion);

      const pending = selectModel(configFixture, { renderer });

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(lines.some((line) => line.includes('选择模型'))).toBe(true);
        expect(lines.some((line) => line.includes('Kimi Default'))).toBe(true);
        expect(lines.some((line) => line.includes('Kimi K2 Thinking'))).toBe(true);
        expect(lines.some((line) => line.includes('Kimi K2 Fast'))).toBe(true);
        expect(lines.some((line) => line.includes('↑↓ 选择  Enter 确认  Esc 取消'))).toBe(true);
        expect(lines.some((line) => line.includes('❯ Type your message...'))).toBe(true);
      });

      harness.send('\x1b');
      await expect(pending).resolves.toBeNull();

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(lines.some((line) => line.includes('选择模型'))).toBe(false);
        expect(lines.some((line) => line.includes('Kimi Default'))).toBe(false);
        expect(lines.some((line) => line.includes('↑↓ 选择  Enter 确认  Esc 取消'))).toBe(false);
        expect(lines.some((line) => line.includes('❯ Type your message...'))).toBe(true);
      });
    } finally {
      harness.restore();
    }
  });
});
