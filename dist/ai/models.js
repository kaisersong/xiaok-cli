import { ClaudeAdapter } from './adapters/claude.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { OpenAIResponsesAdapter } from './adapters/openai-responses.js';
import { resolveRuntimeModelBinding } from './providers/control-plane.js';
export function createAdapterFromBinding(binding) {
    if (binding.protocol === 'anthropic') {
        return new ClaudeAdapter(binding.apiKey, binding.wireModel, binding.baseUrl);
    }
    if (binding.protocol === 'openai_legacy') {
        return new OpenAIAdapter(binding.apiKey, binding.wireModel, binding.baseUrl, binding.headers);
    }
    if (binding.protocol === 'openai_responses') {
        return new OpenAIResponsesAdapter(binding.apiKey, binding.wireModel, binding.baseUrl, binding.headers);
    }
    throw new Error(`未知的模型协议: ${binding.protocol}`);
}
export function createAdapter(rawConfig) {
    return createAdapterFromBinding(resolveRuntimeModelBinding(rawConfig));
}
