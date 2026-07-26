import type { Config, LegacyConfig } from '../../types.js';
import { normalizeConfig } from './normalize.js';
import { getProviderProfile } from './registry.js';
import type { ModelRuntimeOptions, ProtocolId, ProviderModelVariant, ProviderProfile } from './types.js';
import { resolveProviderTransport } from './auth-resolver.js';
import { resolveConfiguredModelBinding } from './model-binding.js';
import {
  isOfficialKimiK3OpenAIEndpoint,
  resolveModelRuntimeOptions,
} from './model-runtime-options.js';

export interface ResolvedModelBinding {
  providerId: string;
  providerType: 'first_party' | 'custom';
  modelId: string;
  wireModel: string;
  protocol: ProtocolId;
  apiKey: string;
  baseUrl?: string;
  headers: Record<string, string>;
  capabilities: string[];
  runtimeOptions?: ModelRuntimeOptions;
}

function findExactCatalogModel(
  profile: ProviderProfile | undefined,
  modelId: string,
  wireModel: string,
): ProviderModelVariant | undefined {
  if (!profile) return undefined;

  return [profile.defaultModel, ...(profile.availableModels ?? [])]
    .find((variant) => variant.modelId === modelId && variant.model === wireModel);
}

export function resolveRuntimeModelBinding(rawConfig: Config | LegacyConfig, requestedModelId?: string): ResolvedModelBinding {
  const config = normalizeConfig(rawConfig);
  const { modelId, providerId, modelEntry, providerConfig } = resolveConfiguredModelBinding(config, requestedModelId);
  const providerProfile = getProviderProfile(providerId);
  const transport = resolveProviderTransport(config, providerId);
  const wireModel = modelEntry.model
    || providerProfile?.defaultModel.model
    || (providerConfig.protocol === 'anthropic' ? 'claude-opus-4-6' : 'default');
  const catalogModel = findExactCatalogModel(providerProfile, modelId, wireModel);

  if (!transport.apiKey && providerConfig.type !== 'custom') {
    const envHint = (providerProfile?.envPrefixes[0] ?? providerId.toUpperCase()).toUpperCase();
    throw new Error(
      `未配置 API Key。请运行: xiaok config set api-key <key> --provider ${providerId}\n` +
      `或设置环境变量 XIAOK_${envHint}_API_KEY`
    );
  }

  if (providerConfig.type === 'custom' && !transport.baseUrl) {
    throw new Error('custom 模型需要配置 baseUrl。请运行: xiaok config set model custom --base-url <url>');
  }

  const catalogRuntimeModel = providerId === 'kimi'
    && catalogModel?.model === 'k3'
    && (
      providerConfig.protocol !== 'openai_legacy'
      || !isOfficialKimiK3OpenAIEndpoint(transport.baseUrl)
    )
    ? undefined
    : catalogModel;
  const acceptsConfiguredRuntimeOptions = providerId !== 'kimi' || (
    wireModel === 'k3'
    && providerConfig.protocol === 'openai_legacy'
    && isOfficialKimiK3OpenAIEndpoint(transport.baseUrl)
  );
  const configuredRuntimeOptions = acceptsConfiguredRuntimeOptions
    ? modelEntry.runtimeOptions
    : undefined;
  const { runtimeOptions } = resolveModelRuntimeOptions({
    protocol: providerConfig.protocol,
    baseUrl: transport.baseUrl,
    wireModel,
    catalogOptions: catalogRuntimeModel?.runtimeOptions,
    catalogConstraints: catalogRuntimeModel?.runtimeConstraints,
    configuredOptions: configuredRuntimeOptions,
  });

  return {
    providerId,
    providerType: providerConfig.type,
    modelId,
    wireModel,
    protocol: providerConfig.protocol,
    apiKey: transport.apiKey,
    baseUrl: transport.baseUrl,
    headers: transport.headers,
    capabilities: modelEntry.capabilities ?? providerProfile?.defaultModel.capabilities ?? [],
    ...(runtimeOptions ? { runtimeOptions } : {}),
  };
}
