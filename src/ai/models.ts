import type { ModelAdapter } from '../types.js';
import type { Config, LegacyConfig } from '../types.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { OpenAIResponsesAdapter } from './adapters/openai-responses.js';
import { resolveRuntimeModelBinding, type ResolvedModelBinding } from './providers/control-plane.js';
import { modelCapabilitiesFromFlags } from './runtime/model-capabilities.js';
import {
  buildOpenAIHarnessContext,
  resolveKimiHarnessFeatureFlags,
  type OpenAIAdapterInit,
} from './providers/model-harness-profile.js';

const KIMI_CODING_COMPAT_USER_AGENT = 'claude-cli/1.0.0 (external, cli)';
const KIMI_CODING_COMPAT_HEADERS = Object.freeze({
  'User-Agent': KIMI_CODING_COMPAT_USER_AGENT,
  'X-Stainless-Lang': null,
  'X-Stainless-Package-Version': null,
  'X-Stainless-OS': null,
  'X-Stainless-Arch': null,
  'X-Stainless-Runtime': null,
  'X-Stainless-Runtime-Version': null,
  'X-Stainless-Retry-Count': null,
  'X-Stainless-Timeout': null,
});

function isKimiCodingCompatibilityEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false;

  try {
    const url = new URL(baseUrl);
    return url.hostname === 'api.kimi.com'
      && url.pathname.startsWith('/coding');
  } catch {
    return false;
  }
}

export function resolveOpenAICompatibilityHeaders(binding: ResolvedModelBinding): {
  resolvedHeaders: Record<string, string | null>;
  kimiCodingHeadersApplied: boolean;
} {
  const kimiCodingHeadersApplied = isKimiCodingCompatibilityEndpoint(binding.baseUrl);
  return {
    resolvedHeaders: {
      ...binding.headers,
      ...(kimiCodingHeadersApplied ? KIMI_CODING_COMPAT_HEADERS : {}),
    },
    kimiCodingHeadersApplied,
  };
}

export function buildOpenAIAdapterInit(
  binding: ResolvedModelBinding,
  env: Readonly<Record<string, string | undefined>> = process.env,
): OpenAIAdapterInit {
  const identity = {
    providerId: binding.providerId,
    providerType: binding.providerType,
    protocol: binding.protocol,
    canonicalBaseUrl: binding.baseUrl,
    wireModel: binding.wireModel,
    capabilities: [...binding.capabilities],
  };
  const { resolvedHeaders, kimiCodingHeadersApplied } = resolveOpenAICompatibilityHeaders(binding);

  return {
    apiKey: binding.apiKey,
    resolvedHeaders,
    kimiCodingHeadersApplied,
    harnessContext: buildOpenAIHarnessContext({
      identity,
      flags: resolveKimiHarnessFeatureFlags(env),
      runtimeOptions: binding.runtimeOptions,
    }),
  };
}

export function createAdapterFromBinding(binding: ResolvedModelBinding): ModelAdapter {
  const capabilityOverrides = modelCapabilitiesFromFlags(binding.capabilities);

  if (binding.protocol === 'anthropic') {
    return new ClaudeAdapter(binding.apiKey, binding.wireModel, binding.baseUrl, capabilityOverrides);
  }

  if (binding.protocol === 'openai_legacy') {
    return new OpenAIAdapter(buildOpenAIAdapterInit(binding));
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
