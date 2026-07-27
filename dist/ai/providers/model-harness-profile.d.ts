import type { MessageBlock, UsageStats } from '../../types.js';
import { type ModelCapabilities } from '../runtime/model-capabilities.js';
import { type NormalizedKimiSchema } from './kimi-tool-schema.js';
import type { ModelRuntimeOptions, ProtocolId } from './types.js';
export type ReasoningKeyName = 'reasoning_content' | 'reasoning';
export interface ReasoningDialectState {
    current: ReasoningKeyName;
    learned: boolean;
}
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
export type KimiUsageDiagnostic = {
    readonly type: 'usage_source';
    readonly harnessProfileId: 'kimi-k3-coding-openai';
    readonly usageSource: 'provider' | 'estimate' | 'missing_on_error';
} | {
    readonly type: 'invalid_usage';
    readonly harnessProfileId: 'kimi-k3-coding-openai';
    readonly location: 'top_level' | 'choices_0';
    readonly field: 'totals' | 'cached_tokens' | 'prompt_tokens_details.cached_tokens';
    readonly reason: 'incomplete_or_invalid' | 'invalid_or_exceeds_prompt_tokens';
};
export type KimiUsageDiagnosticSink = (diagnostic: KimiUsageDiagnostic) => void;
export interface ModelHarnessProfile {
    readonly id: 'generic-openai' | 'kimi-k3-coding-openai' | 'kimi-k3-256k-coding-openai';
    normalizeToolSchema?: (schema: Record<string, unknown>) => NormalizedKimiSchema;
    serializeReasoning?: (blocks: MessageBlock[], dialect: ReasoningKeyName, preservedThinkingEnabled: boolean) => {
        field: ReasoningKeyName;
        value: string;
    } | undefined;
    encodeCacheKey?: (cacheKey: string) => {
        prompt_cache_key: string;
    };
    extractUsage?: (chunk: Record<string, unknown>, onDiagnostic?: KimiUsageDiagnosticSink) => UsageStats | undefined;
    shouldOmitAssistantContent?: (input: {
        hasToolCalls: boolean;
        text: string;
    }) => boolean;
}
export interface OpenAIHarnessContext {
    readonly identity: AdapterBindingIdentity;
    readonly profile: ModelHarnessProfile;
    readonly identityFingerprint: string;
    readonly flags: Readonly<KimiHarnessFeatureFlags>;
    readonly runtimeOptions?: Readonly<ModelRuntimeOptions>;
    readonly runtimeCapabilities: Readonly<ModelCapabilities>;
}
export interface OpenAIAdapterInit {
    readonly apiKey: string;
    readonly resolvedHeaders?: Readonly<Record<string, string | null>>;
    readonly kimiCodingHeadersApplied: boolean;
    readonly onUsageDiagnostic?: KimiUsageDiagnosticSink;
    readonly harnessContext: OpenAIHarnessContext;
}
export interface BuildOpenAIHarnessContextInput {
    readonly identity: AdapterBindingIdentity;
    readonly flags: Readonly<KimiHarnessFeatureFlags>;
    readonly runtimeOptions?: Readonly<ModelRuntimeOptions>;
    readonly capabilityOverrides?: Partial<ModelCapabilities>;
}
export declare const GENERIC_OPENAI_HARNESS_PROFILE: ModelHarnessProfile;
export declare function isOwnedStrictOpenAIHarnessContext(context: OpenAIHarnessContext): boolean;
export declare const KIMI_K3_CODING_OPENAI_HARNESS_PROFILE: ModelHarnessProfile;
export declare const KIMI_K3_256K_CODING_OPENAI_HARNESS_PROFILE: ModelHarnessProfile;
export declare function observeReasoningDialect(state: ReasoningDialectState, delta: Record<string, unknown>): {
    conflict?: {
        previous: ReasoningKeyName;
        candidate: ReasoningKeyName;
    };
};
export declare function resolveKimiHarnessFeatureFlags(env: Readonly<Record<string, string | undefined>>): KimiHarnessFeatureFlags;
export declare function isKimiK3CodingHarnessBinding(identity: AdapterBindingIdentity): boolean;
export declare function resolveModelHarnessProfile(identity: AdapterBindingIdentity): ModelHarnessProfile;
export declare function buildOpenAIHarnessContext(input: BuildOpenAIHarnessContextInput): OpenAIHarnessContext;
