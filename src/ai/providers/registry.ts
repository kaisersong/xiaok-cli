import type { FirstPartyProviderId, ProviderProfile } from './types.js';

const PROVIDER_REGISTRY: Record<FirstPartyProviderId, ProviderProfile> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai_legacy',
    baseUrl: 'https://api.openai.com/v1',
    envPrefixes: ['OPENAI'],
    defaultModel: {
      modelId: 'openai-default',
      model: 'gpt-4o',
      label: 'OpenAI Default',
      capabilities: ['tools'],
    },
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    envPrefixes: ['ANTHROPIC', 'CLAUDE'],
    defaultModel: {
      modelId: 'anthropic-default',
      model: 'claude-opus-4-6',
      label: 'Anthropic Default',
      capabilities: ['tools'],
    },
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi',
    protocol: 'openai_legacy',
    baseUrl: 'https://api.kimi.com/coding/v1',
    envPrefixes: ['KIMI'],
    defaultModel: {
      modelId: 'kimi-default',
      model: 'kimi-for-coding',
      label: 'Kimi Default',
      capabilities: ['tools', 'thinking'],
    },
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai_legacy',
    baseUrl: 'https://api.deepseek.com/v1',
    envPrefixes: ['DEEPSEEK'],
    defaultModel: {
      modelId: 'deepseek-default',
      model: 'deepseek-chat',
      label: 'DeepSeek Default',
      capabilities: ['tools'],
    },
  },
  glm: {
    id: 'glm',
    label: 'GLM',
    protocol: 'openai_legacy',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    envPrefixes: ['GLM'],
    defaultModel: {
      modelId: 'glm-default',
      model: 'glm-4.5',
      label: 'GLM Default',
      capabilities: ['tools'],
    },
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax',
    protocol: 'openai_legacy',
    baseUrl: 'https://api.minimax.chat/v1',
    envPrefixes: ['MINIMAX'],
    defaultModel: {
      modelId: 'minimax-default',
      model: 'MiniMax-Text-01',
      label: 'MiniMax Default',
      capabilities: ['tools'],
    },
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    protocol: 'openai_responses',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envPrefixes: ['GEMINI'],
    defaultModel: {
      modelId: 'gemini-default',
      model: 'gemini-2.5-pro',
      label: 'Gemini Default',
      capabilities: ['tools', 'thinking', 'image_in'],
    },
  },
};

export function getProviderProfile(providerId: string): ProviderProfile | undefined {
  return PROVIDER_REGISTRY[providerId as FirstPartyProviderId];
}

export function listProviderProfiles(): ProviderProfile[] {
  return Object.values(PROVIDER_REGISTRY);
}
