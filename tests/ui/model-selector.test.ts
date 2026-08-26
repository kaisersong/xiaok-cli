import { describe, expect, it } from 'vitest';
import { buildModelOptions, selectModel } from '../../src/ui/model-selector.js';
import { createTtyHarness } from '../support/tty.js';
import { waitFor } from '../support/wait-for.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';
import { getProviderProfile } from '../../src/ai/providers/registry.js';

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

    // 契约式断言而非全量有序列表：给任意 provider 增删模型都不该需要改这个测试。
    // 之前这里断言 8 个 id 与 8 个 label 的完整顺序，任何目录变动都会误报。
    const ids = options.map((option) => option.id);
    const profile = getProviderProfile('kimi')!;
    const catalogIds = (profile.availableModels ?? []).map((variant) => variant.modelId);

    // 1. 无重复
    expect(new Set(ids).size).toBe(ids.length);

    // 2. 已配置的模型全部出现，且排在所有仅存在于目录里的模型之前
    const configuredIds = ['kimi-coding', 'kimi-k2-thinking'];
    for (const id of configuredIds) expect(ids).toContain(id);
    const lastConfigured = Math.max(...configuredIds.map((id) => ids.indexOf(id)));
    const firstCatalogOnly = Math.min(
      ...catalogIds.filter((id) => !configuredIds.includes(id)).map((id) => ids.indexOf(id)),
    );
    expect(lastConfigured).toBeLessThan(firstCatalogOnly);

    // 3. 目录里的模型全部出现，且 label 取自 registry
    for (const variant of profile.availableModels ?? []) {
      if (configuredIds.includes(variant.modelId)) continue;
      const option = options.find((candidate) => candidate.id === variant.modelId);
      expect(option, variant.modelId).toBeDefined();
      expect(option?.label, variant.modelId).toBe(variant.label);
    }
  });

  it('lists GLM-5.3-Flash when the first-party GLM provider is configured', () => {
    const options = buildModelOptions({
      ...configFixture,
      providers: {
        ...configFixture.providers,
        glm: {
          type: 'first_party' as const,
          protocol: 'openai_legacy' as const,
          apiKey: 'sk-glm',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        },
      },
    });

    expect(options).toContainEqual({
      id: 'glm-5.3-flash',
      provider: 'glm',
      model: 'glm-5.3-flash',
      label: 'GLM 5.3 Flash',
      desc: 'GLM',
    });
  });

  it('lists DeepSeek V4 Flash Vision Exp when the first-party provider is configured', () => {
    const options = buildModelOptions({
      ...configFixture,
      providers: {
        ...configFixture.providers,
        deepseek: {
          type: 'first_party' as const,
          protocol: 'openai_legacy' as const,
          apiKey: 'sk-deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
        },
      },
    });

    expect(options).toContainEqual({
      id: 'deepseek-v4-flash-vision-exp',
      provider: 'deepseek',
      model: 'deepseek-v4-flash-vision-exp',
      label: 'DeepSeek V4 Flash Vision Exp',
      desc: 'DeepSeek',
    });
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

  it('clears a stale slash overlay before rendering the model selector in Windows tmux mode', async () => {
    const previousTmux = process.env.TMUX;
    const harness = createTtyHarness(80, 24);
    const renderer = new ReplRenderer(process.stdout);
    const scrollRegion = new ScrollRegionManager(process.stdout);
    const promptGlyph = process.platform === 'win32' ? '>' : '❯';

    try {
      process.env.TMUX = 'tmux-test,1,0';
      scrollRegion.begin();
      scrollRegion.renderPromptFrame({
        inputValue: '/mod',
        cursor: 4,
        placeholder: 'Type your message...',
        statusLine: 'kimi-for-coding · 16% · master · xiaok-cli',
        overlayLines: [
          '  ❯ /mode  查看当前权限模式',
          '    /mode default  切到 default',
          '    /mode auto  切到 auto',
          '    /models  打开模型选择器',
        ],
      });
      scrollRegion.renderPromptFrame({
        inputValue: '/mod',
        cursor: 4,
        placeholder: 'Type your message...',
        statusLine: 'kimi-for-coding · 16% · master · xiaok-cli',
        overlayLines: [],
      });
      scrollRegion.clearOverlayPromptState();
      renderer.setScrollRegion(scrollRegion);

      const pending = selectModel(configFixture, { renderer });

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(lines.some((line) => line.includes('选择模型'))).toBe(true);
        expect(lines.some((line) => line.includes('Kimi Default'))).toBe(true);
        expect(lines.some((line) => line.includes('/mode'))).toBe(false);
        expect(lines.some((line) => line.includes('/models'))).toBe(false);
        expect(lines.some((line) => line.includes(`${promptGlyph} Type your message...`))).toBe(true);
      });

      harness.send('\x1b');
      await expect(pending).resolves.toBeNull();
    } finally {
      if (previousTmux === undefined) {
        delete process.env.TMUX;
      } else {
        process.env.TMUX = previousTmux;
      }
      harness.restore();
    }
  });
});
