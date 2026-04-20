import type { Config, LegacyConfig } from '../../types.js';
import { normalizeConfig } from './normalize.js';
import { getProviderProfile } from './registry.js';
import type { ProtocolId } from './types.js';
import { resolveProviderTransport } from './auth-resolver.js';
import { resolveConfiguredModelBinding } from './model-binding.js';

export interface ResolvedModelBinding {
  providerId: string;
  modelId: string;
  wireModel: string;
  protocol: ProtocolId;
  apiKey: string;
  baseUrl?: string;
  headers: Record<string, string>;
  capabilities: string[];
}

export function resolveRuntimeModelBinding(rawConfig: Config | LegacyConfig, requestedModelId?: string): ResolvedModelBinding {
  const config = normalizeConfig(rawConfig);
  const { modelId, providerId, modelEntry, providerConfig } = resolveConfiguredModelBinding(config, requestedModelId);
  const providerProfile = getProviderProfile(providerId);
  const transport = resolveProviderTransport(config, providerId);

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

  return {
    providerId,
    modelId,
    wireModel: modelEntry.model || providerProfile?.defaultModel.model || (providerConfig.protocol === 'anthropic' ? 'claude-opus-4-6' : 'default'),
    protocol: providerConfig.protocol,
    apiKey: transport.apiKey,
    baseUrl: transport.baseUrl,
    headers: transport.headers,
    capabilities: modelEntry.capabilities ?? providerProfile?.defaultModel.capabilities ?? [],
  };
}
