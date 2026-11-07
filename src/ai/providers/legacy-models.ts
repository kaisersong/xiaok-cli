import type { ProviderModelVariant } from './types.js';

// Metadata only: never exposed in the built-in picker or used as new defaults.
const LEGACY_MODELS: Record<string, ProviderModelVariant[]> = {
  openai: [
    { modelId: 'openai-gpt-5', model: 'gpt-5', label: 'GPT-5', capabilities: ['tools'], runtimeOptions: { contextLimit: 400_000, reasoningEffort: 'medium' }, runtimeConstraints: { reasoningEfforts: ['minimal', 'low', 'medium', 'high'] } },
    { modelId: 'openai-gpt-4o', model: 'gpt-4o', label: 'GPT-4o', capabilities: ['tools'], runtimeOptions: { contextLimit: 128_000 } },
    { modelId: 'openai-gpt-4.1', model: 'gpt-4.1', label: 'GPT-4.1', capabilities: ['tools'], runtimeOptions: { contextLimit: 1_047_576 } },
    { modelId: 'openai-o4-mini', model: 'o4-mini', label: 'o4-mini', capabilities: ['tools', 'thinking'], runtimeOptions: { contextLimit: 200_000 } },
    { modelId: 'openai-o3', model: 'o3', label: 'o3', capabilities: ['tools', 'thinking'], runtimeOptions: { contextLimit: 200_000 } },
  ],
  anthropic: [
    { modelId: 'anthropic-claude-haiku-4-5', model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', capabilities: ['tools'] },
  ],
  gemini: [
    { modelId: 'gemini-2.5-pro', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', capabilities: ['tools', 'thinking', 'image_in'], runtimeOptions: { contextLimit: 1_048_576 } },
    { modelId: 'gemini-2.5-flash', model: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash', capabilities: ['tools', 'thinking', 'image_in'], runtimeOptions: { contextLimit: 1_048_576 } },
  ],
};

export function findLegacyProviderModel(providerId: string, wireModel: string): ProviderModelVariant | undefined {
  return LEGACY_MODELS[providerId]?.find(model => model.model === wireModel);
}
