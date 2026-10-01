import type { ModelAdapter } from '../types.js';
import type { Config, LegacyConfig } from '../types.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { OpenAIResponsesAdapter } from './adapters/openai-responses.js';
import { SystemOneAdapter } from './adapters/system-one.js';
import { resolveRuntimeModelBinding, type ResolvedModelBinding } from './providers/control-plane.js';
import {
  resolveSystemOneConfig,
  SYSTEM_ONE_CONTEXT_LIMIT,
  SYSTEM_ONE_KEY_ENV_VARS,
} from './providers/system-one-config.js';
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
  // 只透传 contextLimit：reasoningEffort 是 OpenAI-compatible 的请求字段，
  // Claude 用 thinking.type、Gemini 用别的机制，透传过去没有接收方。
  const capabilityOverrides = {
    ...modelCapabilitiesFromFlags(binding.capabilities),
    ...(binding.runtimeOptions?.contextLimit !== undefined
      ? { contextLimit: binding.runtimeOptions.contextLimit }
      : {}),
  };
  // cloneWithModel 需要它才能按新模型重查目录，而不是沿用旧模型的窗口。
  const catalogIdentity = {
    providerId: binding.providerId,
    providerType: binding.providerType,
  };

  if (binding.protocol === 'anthropic') {
    return new ClaudeAdapter(
      binding.apiKey,
      binding.wireModel,
      binding.baseUrl,
      capabilityOverrides,
      catalogIdentity,
    );
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
      catalogIdentity,
    );
  }

  throw new Error(`未知的模型协议: ${binding.protocol}`);
}

export function createAdapter(rawConfig: Config | LegacyConfig): ModelAdapter {
  return createAdapterFromBinding(resolveRuntimeModelBinding(rawConfig));
}

/**
 * 构造 System One（Jev）辅助决策模型适配器。
 *
 * Jev 不参与 `config.models` / `config.defaultModelId` 的推理模型选择，
 * 所以这里直接从 `config.systemOne` 解析，而不是走 `createAdapterFromBinding`
 * —— 后者要求 provider 出现在 first-party registry 里。
 */
export function createSystemOneAdapter(
  config: Pick<Config, 'systemOne'> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): SystemOneAdapter {
  const resolved = resolveSystemOneConfig(config, env);
  if (!resolved.apiKey) {
    throw new Error(
      '未配置 System One（Jev）API Key。'
      + '可运行 `xiaok config set system-one-api-key <key>`，'
      + `或设置环境变量 ${SYSTEM_ONE_KEY_ENV_VARS.join(' / ')}。`,
    );
  }

  return new SystemOneAdapter({
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    capabilityOverrides: { contextLimit: SYSTEM_ONE_CONTEXT_LIMIT },
  });
}
