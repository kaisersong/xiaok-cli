import type { ModelAdapter } from '../types.js';
import type { Config, LegacyConfig } from '../types.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { OpenAIResponsesAdapter } from './adapters/openai-responses.js';
import { resolveRuntimeModelBinding, type ResolvedModelBinding } from './providers/control-plane.js';

export function createAdapterFromBinding(binding: ResolvedModelBinding): ModelAdapter {
  if (binding.protocol === 'anthropic') {
    return new ClaudeAdapter(binding.apiKey, binding.wireModel, binding.baseUrl);
  }

  if (binding.protocol === 'openai_legacy') {
    return new OpenAIAdapter(
      binding.apiKey,
      binding.wireModel,
      binding.baseUrl,
      binding.headers,
    );
  }

  if (binding.protocol === 'openai_responses') {
    return new OpenAIResponsesAdapter(
      binding.apiKey,
      binding.wireModel,
      binding.baseUrl,
      binding.headers,
    );
  }

  throw new Error(`未知的模型协议: ${binding.protocol}`);
}

export function createAdapter(rawConfig: Config | LegacyConfig): ModelAdapter {
  return createAdapterFromBinding(resolveRuntimeModelBinding(rawConfig));
}
