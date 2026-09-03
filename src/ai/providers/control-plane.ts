import type { Config, LegacyConfig } from '../../types.js';
import { normalizeConfig } from './normalize.js';
import { findCatalogModel, getProviderProfile } from './registry.js';
import type { ModelRuntimeOptions, ProtocolId } from './types.js';
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

export class MissingProviderApiKeyError extends Error {
  readonly code = 'missing_provider_api_key';

  constructor(
    readonly providerId: string,
    envHint: string,
  ) {
    super(
      `未配置 API Key。首次使用请运行: xiaok login\n`
      + `脚本配置: xiaok config set api-key <key> --provider ${providerId}\n`
      + `或设置环境变量 XIAOK_${envHint}_API_KEY（也支持标准环境变量 ${envHint}_API_KEY）\n`
      + '如果已设置环境变量但仍报此错，可运行: xiaok doctor --check-keys 验证候选 Key 是否可用',
    );
  }
}

export function resolveRuntimeModelBinding(rawConfig: Config | LegacyConfig, requestedModelId?: string): ResolvedModelBinding {
  const config = normalizeConfig(rawConfig);
  const { modelId, providerId, modelEntry, providerConfig } = resolveConfiguredModelBinding(config, requestedModelId);
  const providerProfile = getProviderProfile(providerId);
  const transport = resolveProviderTransport(config, providerId);
  const wireModel = modelEntry.model
    || providerProfile?.defaultModel.model
    || (providerConfig.protocol === 'anthropic' ? 'claude-opus-4-6' : 'default');
  // getProviderProfile 按 id 查表，不看 providerConfig.type —— 所以一个 id 与官方
  // 撞名的 custom provider（Desktop 允许用户把自定义 provider 命名为 "GLM"）会拿到
  // 官方 profile。只有 first-party 才允许继承 catalog 元数据。
  const catalogModel = providerConfig.type === 'first_party'
    ? findCatalogModel(providerProfile, modelId, wireModel)
    : undefined;

  if (!transport.apiKey && providerConfig.type !== 'custom') {
    const envHint = (providerProfile?.envPrefixes[0] ?? providerId.toUpperCase()).toUpperCase();
    throw new MissingProviderApiKeyError(providerId, envHint);
  }

  if (providerConfig.type === 'custom' && !transport.baseUrl) {
    throw new Error('custom 模型需要配置 baseUrl。请运行: xiaok config set model custom --base-url <url>');
  }

  const catalogRuntimeModel = providerId === 'kimi'
    && (catalogModel?.model === 'k3' || catalogModel?.model === 'k3-256k')
    && (
      providerConfig.protocol !== 'openai_legacy'
      || !isOfficialKimiK3OpenAIEndpoint(transport.baseUrl)
    )
    ? undefined
    : catalogModel;
  const acceptsConfiguredRuntimeOptions = providerId !== 'kimi' || (
    (wireModel === 'k3' || wireModel === 'k3-256k')
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
