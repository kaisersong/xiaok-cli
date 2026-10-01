import type { Config, LegacyConfig } from '../../src/types.js';
import type { ModelReasoningEffort } from '../../src/ai/providers/types.js';

interface OldModelConfigCase {
  name: string;
  config: Config | LegacyConfig;
  wireModel: string;
  effort?: ModelReasoningEffort;
  contextLimit?: number;
}

export const OLD_MODEL_EFFORT_CONFIGS: OldModelConfigCase[] = [];
for (const [providerId, wireModel, effort, window] of [
  ['kimi', 'k3', 'high', 262_144],
  ['kimi', 'k3-256k', 'high', 262_144],
  ['glm', 'GLM-5.3', 'high', 1_048_576],
  ['glm', 'glm-5.3-flash', 'high', 1_048_576],
  ['openai', 'gpt-5', 'medium', 400_000],
  ['openai', 'gpt-5.5', 'medium', 1_050_000],
] as const) {
  for (const contextOnly of [false, true]) {
    OLD_MODEL_EFFORT_CONFIGS.push({
      name: `${providerId}/${wireModel}: ${contextOnly ? 'context-only' : 'no runtime options'}, omitted baseUrl`,
      wireModel, effort, contextLimit: contextOnly ? 128_000 : window,
      config: {
        schemaVersion: 2, defaultProvider: providerId, defaultModelId: 'old-pinned-model',
        providers: { [providerId]: { type: 'first_party', protocol: 'openai_legacy', apiKey: 'test-compat-key', headers: { 'x-old-header': 'preserved' } } },
        models: { 'old-pinned-model': { provider: providerId, model: wireModel, label: 'Pinned old model', ...(contextOnly ? { runtimeOptions: { contextLimit: 128_000 } } : {}) } },
        defaultMode: 'interactive', channels: {},
      },
    });
  }
}
for (const [providerId, wireModel, endpoint, effort, contextLimit] of [
  ['kimi', 'k3', 'https://api.kimi.com/coding/v1', 'high', 262_144],
  ['glm', 'GLM-5.3', 'https://open.bigmodel.cn/api/paas/v4', 'high', 1_048_576],
  ['acme', 'old-custom-model', 'https://example.com/v1', undefined, undefined],
] as const) {
  OLD_MODEL_EFFORT_CONFIGS.push({ name: `schema v1 ${providerId}/${wireModel}`, wireModel, effort, contextLimit,
    config: { schemaVersion: 1, defaultModel: 'custom', models: { custom: { apiKey: 'test-compat-key', model: wireModel, baseUrl: endpoint } }, defaultMode: 'interactive', channels: {} },
  });
}
OLD_MODEL_EFFORT_CONFIGS.push({ name: 'schema v1 OpenAI GPT-5.5', wireModel: 'gpt-5.5', effort: 'medium', contextLimit: 1_050_000,
  config: { schemaVersion: 1, defaultModel: 'openai', models: { openai: { apiKey: 'test-compat-key', model: 'gpt-5.5' } }, defaultMode: 'interactive', channels: {} },
});
for (const [providerId, model, protocol, type, baseUrl] of [
  ['openai', 'gpt-4o', 'openai_legacy', 'first_party', undefined],
  ['glm', 'GLM-5.2', 'openai_legacy', 'first_party', undefined],
  ['openai', 'gpt-5.5', 'openai_responses', 'first_party', undefined],
  ['acme', 'old-custom-model', 'openai_legacy', 'custom', 'https://example.com/v1'],
  ['openai', 'gpt-5.5', 'openai_legacy', 'custom', 'https://example.com/v1'],
] as const) {
  OLD_MODEL_EFFORT_CONFIGS.push({ name: `unsupported ${providerId}/${model}/${protocol}`, wireModel: model, contextLimit: 128_000,
    config: { schemaVersion: 2, defaultProvider: providerId, defaultModelId: 'old-pinned-model',
      providers: { [providerId]: { type, protocol, baseUrl, apiKey: 'test-compat-key' } },
      models: { 'old-pinned-model': { provider: providerId, model, label: 'Pinned old model', runtimeOptions: { contextLimit: 128_000 } } }, defaultMode: 'interactive', channels: {} },
  });
}
