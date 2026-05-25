import type { ModelAdapter } from '../types.js';
import type { Config, LegacyConfig } from '../types.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { OpenAIResponsesAdapter } from './adapters/openai-responses.js';
import { resolveRuntimeModelBinding, type ResolvedModelBinding } from './providers/control-plane.js';
import { modelCapabilitiesFromFlags } from './runtime/model-capabilities.js';

export function createAdapterFromBinding(binding: ResolvedModelBinding): ModelAdapter {
  const capabilityOverrides = modelCapabilitiesFromFlags(binding.capabilities);

  if (binding.protocol === 'anthropic') {
    return new ClaudeAdapter(binding.apiKey, binding.wireModel, binding.baseUrl, capabilityOverrides);
  }

  if (binding.protocol === 'openai_legacy') {
    return new OpenAIAdapter(
      binding.apiKey,
      binding.wireModel,
      binding.baseUrl,
      binding.headers,
      capabilityOverrides,
    );
  }

  if (binding.protocol === 'openai_responses') {
    return new OpenAIResponsesAdapter(
      binding.apiKey,
      binding.wireModel,
      binding.baseUrl,
      binding.headers,
      capabilityOverrides,
    );
  }

  throw new Error(`未知的模型协议: ${binding.protocol}`);
}

export function createAdapter(rawConfig: Config | LegacyConfig): ModelAdapter {
  return createAdapterFromBinding(resolveRuntimeModelBinding(rawConfig));
}
