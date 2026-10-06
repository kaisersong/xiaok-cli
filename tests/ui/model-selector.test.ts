import { OLD_MODEL_EFFORT_CONFIGS } from '../support/model-effort-compatibility.js';
import { normalizeConfig } from '../../src/ai/providers/normalize.js';
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
  it('changes only a supported model effort with left/right and returns it on confirmation', async () => {
    const config = {
      ...configFixture,
      defaultModelId: 'kimi-k3',
      models: {
        'kimi-k3': {
          provider: 'kimi', model: 'k3', label: 'Kimi K3',
          runtimeOptions: { contextLimit: 262_144, reasoningEffort: 'high' as const },
        },
      },
    };
    const harness = createTtyHarness(80, 24);
    const renderer = new ReplRenderer(process.stdout);
    const scrollRegion = new ScrollRegionManager(process.stdout);
    try {
      scrollRegion.begin();
      scrollRegion.renderFooter({ inputPrompt: 'Type your message...', statusLine: 'Kimi K3' });
      renderer.setScrollRegion(scrollRegion);
      const pending = selectModel(config, { renderer });
      await waitFor(() => expect(harness.screen.lines().some(line => line.includes('HIGH'))).toBe(true));
      harness.send('\x1b[C');
      await waitFor(() => expect(harness.screen.lines().some(line => line.includes('MAX'))).toBe(true));
      harness.send('\r');
      await expect(pending).resolves.toMatchObject({ modelId: 'kimi-k3', reasoningEffort: 'max' });
      expect(config.models['kimi-k3'].runtimeOptions.reasoningEffort).toBe('high');
    } finally {
      harness.restore();
    }
  });

  it.each(OLD_MODEL_EFFORT_CONFIGS)('can confirm or cancel a strength-free old config: $name', async ({ config, wireModel, effort }) => {
    const normalized = normalizeConfig(config);
    const before = structuredClone(normalized);
    const harness = createTtyHarness(120, 40);
    try {
      let pending = selectModel(normalized);
      harness.send('\x1b');
      await expect(pending).resolves.toBeNull();
      expect(normalized).toEqual(before);
      pending = selectModel(normalized);
      harness.send('\r');
      await expect(pending).resolves.toMatchObject({ model: wireModel, ...(effort ? { reasoningEffort: effort } : {}) });
      expect(normalized).toEqual(before);
    } finally { harness.restore(); }
  });

  it('confirms the middle GLM tier without requiring any arrow key', async () => {
    const config = { ...configFixture, defaultProvider: 'glm', defaultModelId: 'glm-5.3', providers: { glm: { type: 'first_party' as const, protocol: 'openai_legacy' as const, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' } }, models: { 'glm-5.3': { provider: 'glm', model: 'GLM-5.3', label: 'GLM 5.3' } } };
    const harness = createTtyHarness(100, 24);
    try {
      const pending = selectModel(config);
      harness.send('\r');
      await expect(pending).resolves.toMatchObject({ reasoningEffort: 'high' });
    } finally { harness.restore(); }
  });

  it('does not offer effort for a model without declared effort constraints', async () => {
    const harness = createTtyHarness(80, 24);
    const renderer = new ReplRenderer(process.stdout);
    const scrollRegion = new ScrollRegionManager(process.stdout);
    try {
      scrollRegion.begin();
      scrollRegion.renderFooter({ inputPrompt: 'Type your message...', statusLine: 'Kimi Coding' });
      renderer.setScrollRegion(scrollRegion);
      const pending = selectModel(configFixture, { renderer });
      harness.send('\x1b[C');
      harness.send('\r');
      await expect(pending).resolves.toEqual({
        modelId: 'kimi-coding', provider: 'kimi', model: 'kimi-for-coding', label: 'Kimi Default',
      });
    } finally {
      harness.restore();
    }
  });

  it('does not offer a catalog effort on a protocol that cannot send it', async () => {
    const config = {
      ...configFixture,
      defaultProvider: 'glm',
      defaultModelId: 'glm-5.3',
      providers: {
        glm: { type: 'first_party' as const, protocol: 'openai_responses' as const, apiKey: 'sk-glm' },
      },
      models: {
        'glm-5.3': { provider: 'glm', model: 'GLM-5.3', label: 'GLM 5.3' },
      },
    };
    const harness = createTtyHarness(80, 24);
    const renderer = new ReplRenderer(process.stdout);
    const scrollRegion = new ScrollRegionManager(process.stdout);
    try {
      scrollRegion.begin();
      scrollRegion.renderFooter({ inputPrompt: 'Type your message...', statusLine: 'GLM 5.3' });
      renderer.setScrollRegion(scrollRegion);
      const pending = selectModel(config, { renderer });
      harness.send('\x1b[C');
      harness.send('\r');
      await expect(pending).resolves.toEqual({
        modelId: 'glm-5.3', provider: 'glm', model: 'GLM-5.3', label: 'GLM 5.3',
      });
    } finally {
      harness.restore();
    }
  });

  it('groups interleaved configured and catalog models by provider without mutating config', () => {
    const config = {
      ...configFixture,
      providers: {
        kimi: configFixture.providers.kimi,
        'z-local': { type: 'custom' as const, protocol: 'openai_legacy' as const },
        glm: { type: 'first_party' as const, protocol: 'openai_legacy' as const },
      },
      models: {
        'kimi-coding': configFixture.models['kimi-coding'],
        'local-qwen': { provider: 'z-local', model: 'qwen', label: 'Local' },
        'glm-configured': { provider: 'glm', model: 'glm-test', label: 'Configured GLM' },
        'kimi-k2-fast': configFixture.models['kimi-k2-fast'],
        'orphan-model': { provider: 'a-missing', model: 'orphan', label: 'Orphan' },
      },
    };
    const before = structuredClone(config);
    const options = buildModelOptions(config);
    const groups = options.filter((option, index) => index === 0 || option.provider !== options[index - 1].provider)
      .map(option => option.provider);
    expect(groups).toEqual(['a-missing', 'glm', 'kimi', 'z-local']);
    expect(options.filter(option => option.provider === 'kimi').slice(0, 2).map(option => option.id))
      .toEqual(['kimi-coding', 'kimi-k2-fast']);
    expect(options.findIndex(option => option.id === 'glm-configured'))
      .toBeLessThan(options.findIndex(option => option.id === 'glm-5.3-flash'));
    expect(new Set(options.map(option => option.id)).size).toBe(options.length);
    expect(config).toEqual(before);
  });

  it.each([false, true])('preserves current selection and navigates provider groups (renderer=%s)', async (useRenderer) => {
    const config = {
      ...configFixture,
      defaultModelId: 'z-second',
      providers: {
        zeta: { type: 'custom' as const, protocol: 'openai_legacy' as const },
        alpha: { type: 'custom' as const, protocol: 'openai_legacy' as const },
      },
      models: {
        'z-first': { provider: 'zeta', model: 'z1', label: 'Zeta First' },
        'a-first': { provider: 'alpha', model: 'a1', label: 'Alpha First' },
        'z-second': { provider: 'zeta', model: 'z2', label: 'Zeta Second' },
        'a-second': { provider: 'alpha', model: 'a2', label: 'Alpha Second' },
      },
    };
    const before = structuredClone(config);
    const harness = createTtyHarness(100, 24);
    const renderer = new ReplRenderer(process.stdout);
    const scrollRegion = new ScrollRegionManager(process.stdout);
    try {
      if (useRenderer) {
        scrollRegion.begin();
        scrollRegion.renderFooter({ inputPrompt: 'Type your message...', statusLine: 'z2' });
        renderer.setScrollRegion(scrollRegion);
      }
      let pending = selectModel(config, useRenderer ? { renderer } : {});
      const rows = harness.screen.lines().filter(line => /\[(alpha|zeta)\]/.test(line));
      expect(rows.map(line => line.match(/\[(alpha|zeta)\]/)?.[1])).toEqual(['alpha', 'alpha', 'zeta', 'zeta']);
      harness.send('\r');
      await expect(pending).resolves.toMatchObject({ modelId: 'z-second', provider: 'zeta', model: 'z2' });
      pending = selectModel(config, useRenderer ? { renderer } : {});
      harness.send('\x1b[B');
      harness.send('\r');
      await expect(pending).resolves.toMatchObject({ modelId: 'a-first', provider: 'alpha', model: 'a1' });
      pending = selectModel(config, useRenderer ? { renderer } : {});
      harness.send('\x1b[A');
      harness.send('\r');
      await expect(pending).resolves.toMatchObject({ modelId: 'z-first', provider: 'zeta', model: 'z1' });
      expect(config).toEqual(before);
    } finally {
      if (process.stdin.listenerCount('data') > 0) harness.send('\x1b');
      harness.restore();
    }
  });

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
        expect(lines.some((line) => line.includes('↑↓ 选择  ←→ 强度  Enter 确认  Esc 取消'))).toBe(true);
        expect(lines.some((line) => line.includes('❯ Type your message...'))).toBe(true);
      });

      harness.send('\x1b');
      await expect(pending).resolves.toBeNull();

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(lines.some((line) => line.includes('选择模型'))).toBe(false);
        expect(lines.some((line) => line.includes('Kimi Default'))).toBe(false);
        expect(lines.some((line) => line.includes('↑↓ 选择  ←→ 强度  Enter 确认  Esc 取消'))).toBe(false);
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
