import type { Config } from '../../types.js';
import type { ModelConfigEntry, ProviderConfig } from './types.js';

export interface ConfiguredModelBinding {
  modelId: string;
  providerId: string;
  modelEntry: ModelConfigEntry;
  providerConfig: ProviderConfig;
}

export function resolveConfiguredModelBinding(config: Config, requestedModelId = config.defaultModelId): ConfiguredModelBinding {
  const modelEntry = config.models[requestedModelId];
  if (!modelEntry) {
    throw new Error(`未找到默认模型: ${requestedModelId}`);
  }

  const providerId = modelEntry.provider;
  const providerConfig = config.providers[providerId];
  if (!providerConfig) {
    throw new Error(`未找到模型对应的 provider: ${providerId}`);
  }

  return {
    modelId: requestedModelId,
    providerId,
    modelEntry,
    providerConfig,
  };
}
