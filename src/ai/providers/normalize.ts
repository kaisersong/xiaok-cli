import type { Config, LegacyConfig } from '../../types.js';
import type { ModelConfigEntry, ProtocolId, ProviderConfig, ProviderId } from './types.js';
import { DEFAULT_CONFIG } from '../../types.js';
import { getProviderProfile } from './registry.js';

function cloneDefaultConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
}

function isClaudeCompatibleCustomEndpoint(baseUrl?: string, model?: string): boolean {
  const normalizedBaseUrl = (baseUrl ?? '').toLowerCase();
  const normalizedModel = (model ?? '').toLowerCase();

  if (
    normalizedBaseUrl.includes('claude')
    || normalizedBaseUrl.includes('anthropic')
    || normalizedBaseUrl.includes('/messages')
  ) {
    return true;
  }

  return /claude|sonnet|opus|haiku/.test(normalizedModel);
}

function detectKnownProvider(baseUrl?: string): ProviderId | null {
  const normalizedBaseUrl = (baseUrl ?? '').toLowerCase();
  if (normalizedBaseUrl.startsWith('https://api.kimi.com/coding')) return 'kimi';
  if (normalizedBaseUrl.startsWith('https://api.deepseek.com')) return 'deepseek';
  if (normalizedBaseUrl.startsWith('https://open.bigmodel.cn')) return 'glm';
  if (normalizedBaseUrl.startsWith('https://api.minimax.chat')) return 'minimax';
  if (normalizedBaseUrl.startsWith('https://generativelanguage.googleapis.com')) return 'gemini';
  return null;
}

function buildFirstPartyConfig(
  providerId: ProviderId,
  overrides: Partial<ProviderConfig>,
  modelOverride?: Partial<ModelConfigEntry>,
): Config {
  const profile = getProviderProfile(providerId);
  if (!profile) {
    throw new Error(`未知 provider profile: ${providerId}`);
  }

  return {
    schemaVersion: 2,
    defaultProvider: providerId,
    defaultModelId: profile.defaultModel.modelId,
    providers: {
      [providerId]: {
        type: 'first_party',
        protocol: overrides.protocol ?? profile.protocol,
        apiKey: overrides.apiKey,
        baseUrl: overrides.baseUrl ?? profile.baseUrl,
        headers: overrides.headers,
      },
    },
    models: {
      [profile.defaultModel.modelId]: {
        provider: providerId,
        model: modelOverride?.model ?? profile.defaultModel.model,
        label: modelOverride?.label ?? profile.defaultModel.label,
        capabilities: modelOverride?.capabilities ?? profile.defaultModel.capabilities,
      },
    },
    defaultMode: 'interactive',
    channels: {},
  };
}

function normalizeLegacyConfig(config: LegacyConfig): Config {
  if (config.defaultModel === 'claude') {
    return {
      ...buildFirstPartyConfig('anthropic', {
        apiKey: config.models.claude?.apiKey,
        baseUrl: config.models.claude?.baseUrl,
      }, {
        model: config.models.claude?.model,
      }),
      defaultMode: config.defaultMode,
      devApp: config.devApp,
      channels: config.channels ?? {},
    };
  }

  if (config.defaultModel === 'openai') {
    return {
      ...buildFirstPartyConfig('openai', {
        apiKey: config.models.openai?.apiKey,
      }, {
        model: config.models.openai?.model,
      }),
      defaultMode: config.defaultMode,
      devApp: config.devApp,
      channels: config.channels ?? {},
    };
  }

  const customBaseUrl = config.models.custom?.baseUrl;
  const detectedProvider = detectKnownProvider(customBaseUrl);
  if (detectedProvider) {
    const known = buildFirstPartyConfig(detectedProvider, {
      apiKey: config.models.custom?.apiKey,
      baseUrl: customBaseUrl,
    }, {
      model: config.models.custom?.model,
    });
    return {
      ...known,
      defaultMode: config.defaultMode,
      devApp: config.devApp,
      channels: config.channels ?? {},
    };
  }

  const protocol: ProtocolId = isClaudeCompatibleCustomEndpoint(customBaseUrl, config.models.custom?.model)
    ? 'anthropic'
    : 'openai_legacy';

  return {
    schemaVersion: 2,
    defaultProvider: 'custom-default',
    defaultModelId: 'custom-default-model',
    providers: {
      'custom-default': {
        type: 'custom',
        protocol,
        apiKey: config.models.custom?.apiKey,
        baseUrl: customBaseUrl,
      },
    },
    models: {
      'custom-default-model': {
        provider: 'custom-default',
        model: config.models.custom?.model ?? 'default',
        label: 'Custom Default',
      },
    },
    devApp: config.devApp,
    defaultMode: config.defaultMode,
    channels: config.channels ?? {},
  };
}

export function normalizeConfig(config: Config | LegacyConfig): Config {
  if (config.schemaVersion === 2) {
    const defaults = cloneDefaultConfig();
    return {
      ...defaults,
      ...config,
      providers: { ...defaults.providers, ...config.providers },
      models: { ...defaults.models, ...config.models },
      channels: { ...(defaults.channels ?? {}), ...(config.channels ?? {}) },
    };
  }

  return normalizeLegacyConfig(config);
}
