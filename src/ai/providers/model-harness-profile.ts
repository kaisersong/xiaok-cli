import type { MessageBlock, UsageStats } from '../../types.js';
import {
  modelCapabilitiesFromFlags,
  resolveModelCapabilities,
  type ModelCapabilities,
} from '../runtime/model-capabilities.js';
import {
  normalizeKimiToolSchema,
  type NormalizedKimiSchema,
} from './kimi-tool-schema.js';
import type { ModelRuntimeOptions, ProtocolId } from './types.js';

const KIMI_K3_CODING_OPENAI_BASE_URL = 'https://api.kimi.com/coding/v1';

export type ReasoningKeyName = 'reasoning_content' | 'reasoning';

export interface KimiHarnessFeatureFlags {
  readonly normalizeToolSchema: boolean;
  readonly normalizeUsage: boolean;
  readonly omitEmptyAssistantContent: boolean;
  readonly promptCacheKey: boolean;
  readonly preservedThinking: boolean;
}

export interface AdapterBindingIdentity {
  readonly providerId: string;
  readonly providerType: 'first_party' | 'custom';
  readonly protocol: ProtocolId;
  readonly canonicalBaseUrl?: string;
  readonly wireModel: string;
  readonly capabilities: readonly string[];
}

export interface ModelHarnessProfile {
  readonly id: 'generic-openai' | 'kimi-k3-coding-openai';
  normalizeToolSchema?: (
    schema: Record<string, unknown>,
  ) => NormalizedKimiSchema;
  serializeReasoning?: (
    blocks: MessageBlock[],
    dialect: ReasoningKeyName,
    preservedThinkingEnabled: boolean,
  ) => { field: ReasoningKeyName; value: string } | undefined;
  encodeCacheKey?: (cacheKey: string) => { prompt_cache_key: string };
  extractUsage?: (chunk: Record<string, unknown>) => UsageStats | undefined;
  shouldOmitAssistantContent?: (input: {
    hasToolCalls: boolean;
    text: string;
  }) => boolean;
}

export interface OpenAIHarnessContext {
  readonly identity: AdapterBindingIdentity;
  readonly profile: ModelHarnessProfile;
  readonly flags: Readonly<KimiHarnessFeatureFlags>;
  readonly runtimeOptions?: Readonly<ModelRuntimeOptions>;
  readonly runtimeCapabilities: Readonly<ModelCapabilities>;
}

export interface OpenAIAdapterInit {
  readonly apiKey: string;
  readonly resolvedHeaders?: Readonly<Record<string, string | null>>;
  readonly kimiCodingHeadersApplied: boolean;
  readonly harnessContext: OpenAIHarnessContext;
}

export interface BuildOpenAIHarnessContextInput {
  readonly identity: AdapterBindingIdentity;
  readonly flags: Readonly<KimiHarnessFeatureFlags>;
  readonly runtimeOptions?: Readonly<ModelRuntimeOptions>;
  readonly capabilityOverrides?: Partial<ModelCapabilities>;
}

export const GENERIC_OPENAI_HARNESS_PROFILE: ModelHarnessProfile = Object.freeze({
  id: 'generic-openai',
});

export const KIMI_K3_CODING_OPENAI_HARNESS_PROFILE: ModelHarnessProfile = Object.freeze({
  id: 'kimi-k3-coding-openai',
  normalizeToolSchema: normalizeKimiToolSchema,
});

export function resolveKimiHarnessFeatureFlags(
  env: Readonly<Record<string, string | undefined>>,
): KimiHarnessFeatureFlags {
  return Object.freeze({
    normalizeToolSchema: true,
    normalizeUsage: true,
    omitEmptyAssistantContent: true,
    promptCacheKey: env.XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE === '1',
    preservedThinking: env.XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING === '1',
  });
}

export function isKimiK3CodingHarnessBinding(identity: AdapterBindingIdentity): boolean {
  return identity.providerId === 'kimi'
    && identity.providerType === 'first_party'
    && identity.protocol === 'openai_legacy'
    && identity.wireModel === 'k3'
    && (
      identity.canonicalBaseUrl === KIMI_K3_CODING_OPENAI_BASE_URL
      || identity.canonicalBaseUrl === `${KIMI_K3_CODING_OPENAI_BASE_URL}/`
    );
}

export function resolveModelHarnessProfile(
  identity: AdapterBindingIdentity,
): ModelHarnessProfile {
  return isKimiK3CodingHarnessBinding(identity)
    ? KIMI_K3_CODING_OPENAI_HARNESS_PROFILE
    : GENERIC_OPENAI_HARNESS_PROFILE;
}

export function buildOpenAIHarnessContext(
  input: BuildOpenAIHarnessContextInput,
): OpenAIHarnessContext {
  const identity = Object.freeze({
    ...input.identity,
    capabilities: Object.freeze([...input.identity.capabilities]),
  });
  const runtimeOptions = input.runtimeOptions
    ? Object.freeze({ ...input.runtimeOptions })
    : undefined;
  const runtimeCapabilities = Object.freeze({
    ...resolveModelCapabilities(identity.wireModel),
    ...modelCapabilitiesFromFlags([...identity.capabilities]),
    ...input.capabilityOverrides,
    ...(runtimeOptions?.contextLimit !== undefined
      ? { contextLimit: runtimeOptions.contextLimit }
      : {}),
  });

  return Object.freeze({
    identity,
    profile: resolveModelHarnessProfile(identity),
    flags: input.flags,
    ...(runtimeOptions ? { runtimeOptions } : {}),
    runtimeCapabilities,
  });
}
