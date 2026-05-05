export type ProtocolId = 'anthropic' | 'openai_legacy' | 'openai_responses';

export type FirstPartyProviderId =
  | 'openai'
  | 'anthropic'
  | 'kimi'
  | 'deepseek'
  | 'glm'
  | 'minimax'
  | 'gemini';

export type ProviderId = FirstPartyProviderId | string;

export interface ProviderConfig {
  type: 'first_party' | 'custom';
  protocol: ProtocolId;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}

export interface ModelConfigEntry {
  provider: ProviderId;
  model: string;
  label: string;
  capabilities?: string[];
}

export interface ProviderModelVariant {
  modelId: string;
  model: string;
  label: string;
  capabilities?: string[];
}

export interface ProviderProfile {
  id: FirstPartyProviderId;
  label: string;
  protocol: ProtocolId;
  baseUrl?: string;
  envPrefixes: string[];
  defaultHeaders?: Record<string, string>;
  defaultModel: ProviderModelVariant;
  /** 该 provider 的已知模型变体。不在 config.models 中的也会显示在模型选择器里。 */
  availableModels?: ProviderModelVariant[];
}
