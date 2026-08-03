import type { Config, LegacyConfig } from '../../types.js';
import type { ModelConfigEntry, ProtocolId, ProviderConfig, ProviderId } from './types.js';
import { DEFAULT_CONFIG, DEFAULT_INTENT_BOUNDARY_CONFIG } from '../../types.js';
import {
  isOfficialKimiK3OpenAIEndpoint,
  resolveModelRuntimeOptions,
} from './model-runtime-options.js';
import { getProviderModelVariant, getProviderProfile } from './registry.js';

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
  try {
    const endpoint = new URL(baseUrl ?? '');
    if (
      endpoint.protocol === 'https:'
      && endpoint.hostname === 'api.kimi.com'
      && endpoint.port === ''
      && endpoint.username === ''
      && endpoint.password === ''
      && endpoint.pathname.startsWith('/coding')
    ) {
      return 'kimi';
    }
  } catch {
    // Continue with the remaining legacy string classifiers.
  }
  if (normalizedBaseUrl.startsWith('https://api.deepseek.com')) return 'deepseek';
  if (normalizedBaseUrl.startsWith('https://open.bigmodel.cn')) return 'glm';
  // api.minimax.chat 是官方旧域名，存量 legacy 配置里仍有，必须继续识别。
  if (
    normalizedBaseUrl.startsWith('https://api.minimax.chat')
    || normalizedBaseUrl.startsWith('https://api.minimax.io')
    || normalizedBaseUrl.startsWith('https://api.minimaxi.com')
  ) return 'minimax';
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

  const wireModel = modelOverride?.model ?? profile.defaultModel.model;
  const catalogVariant = providerId === 'kimi'
    ? getProviderModelVariant(providerId, wireModel)
    : undefined;
  const capabilities = modelOverride?.capabilities
    ?? catalogVariant?.capabilities
    ?? profile.defaultModel.capabilities;
  const protocol = overrides.protocol ?? profile.protocol;
  const baseUrl = overrides.baseUrl ?? profile.baseUrl;
  const kimiK3RuntimeEligible = providerId === 'kimi'
    && (wireModel === 'k3' || wireModel === 'k3-256k')
    && protocol === 'openai_legacy'
    && isOfficialKimiK3OpenAIEndpoint(baseUrl);
  const catalogRuntimeEligible = providerId !== 'kimi'
    || catalogVariant?.model !== 'k3'
    || kimiK3RuntimeEligible;
  const { runtimeOptions } = resolveModelRuntimeOptions({
    protocol,
    baseUrl,
    wireModel,
    catalogOptions: catalogRuntimeEligible ? catalogVariant?.runtimeOptions : undefined,
    catalogConstraints: catalogRuntimeEligible ? catalogVariant?.runtimeConstraints : undefined,
    configuredOptions: providerId !== 'kimi' || kimiK3RuntimeEligible
      ? modelOverride?.runtimeOptions
      : undefined,
  });

  return {
    schemaVersion: 2,
    defaultProvider: providerId,
    defaultModelId: profile.defaultModel.modelId,
    providers: {
      [providerId]: {
        type: 'first_party',
        protocol,
        apiKey: overrides.apiKey,
        baseUrl,
        headers: overrides.headers,
      },
    },
    models: {
      [profile.defaultModel.modelId]: {
        provider: providerId,
        model: wireModel,
        label: modelOverride?.label ?? catalogVariant?.label ?? profile.defaultModel.label,
        capabilities: capabilities ? [...capabilities] : undefined,
        ...(runtimeOptions ? { runtimeOptions: { ...runtimeOptions } } : {}),
      },
    },
    defaultMode: 'interactive',
    intentBoundary: DEFAULT_INTENT_BOUNDARY_CONFIG,
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
    const legacyModel = config.models.custom?.model
      // 迁移时不要把用户悄悄换代。原先 pin 的裸 `kimi-k2.7` 在官方任何 endpoint
      // 都不存在，`kimi-for-coding` 才是官方在售的 Kimi K2.7 Code。
      ?? (detectedProvider === 'kimi' ? 'kimi-for-coding' : undefined);
    const known = buildFirstPartyConfig(detectedProvider, {
      apiKey: config.models.custom?.apiKey,
      baseUrl: customBaseUrl,
    }, {
      model: legacyModel,
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
    intentBoundary: DEFAULT_INTENT_BOUNDARY_CONFIG,
    channels: config.channels ?? {},
  };
}

export function normalizeConfig(config: Config | LegacyConfig): Config {
  if (config.schemaVersion === 2) {
    const normalized = {
      ...config,
      providers: { ...config.providers },
      models: { ...config.models },
      channels: { ...(config.channels ?? {}) },
    };
    return withNormalizedDefaults(normalized);
  }

  return withNormalizedDefaults(normalizeLegacyConfig(config));
}

function withNormalizedDefaults(config: Config): Config {
  return {
    ...config,
    intentBoundary: {
      ...DEFAULT_INTENT_BOUNDARY_CONFIG,
      ...(config.intentBoundary ?? {}),
    },
    channels: { ...(config.channels ?? {}) },
    automations: {
      globalBackgroundAutoRunEnabled: true,
      ...(config.automations ?? {}),
    },
  };
}
