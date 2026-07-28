import { modelCapabilitiesFromFlags, resolveModelCapabilities, } from '../runtime/model-capabilities.js';
import { normalizeKimiToolSchema, } from './kimi-tool-schema.js';
import { canonicalizeOfficialKimiK3OpenAIEndpoint, isOfficialKimiK3OpenAIEndpoint, } from './model-runtime-options.js';
export const GENERIC_OPENAI_HARNESS_PROFILE = Object.freeze({
    id: 'generic-openai',
});
function serializeKimiReasoning(blocks, dialect, preservedThinkingEnabled) {
    if (!preservedThinkingEnabled) {
        return undefined;
    }
    return {
        field: dialect,
        value: blocks
            .filter((block) => block.type === 'thinking')
            .map((block) => block.thinking)
            .join(''),
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonnegativeSafeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function normalizeKimiUsageSnapshot(value, location, onDiagnostic) {
    if (!isRecord(value)) {
        onDiagnostic?.({
            type: 'invalid_usage',
            harnessProfileId: 'kimi-k3-coding-openai',
            location,
            field: 'totals',
            reason: 'incomplete_or_invalid',
        });
        return undefined;
    }
    const promptTokens = value.prompt_tokens;
    const completionTokens = value.completion_tokens;
    if (!isNonnegativeSafeInteger(promptTokens)
        || !isNonnegativeSafeInteger(completionTokens)) {
        onDiagnostic?.({
            type: 'invalid_usage',
            harnessProfileId: 'kimi-k3-coding-openai',
            location,
            field: 'totals',
            reason: 'incomplete_or_invalid',
        });
        return undefined;
    }
    const directCachedTokens = value.cached_tokens;
    let cacheReadInputTokens;
    if (isNonnegativeSafeInteger(directCachedTokens)
        && directCachedTokens <= promptTokens) {
        cacheReadInputTokens = directCachedTokens;
    }
    else {
        if (hasOwn(value, 'cached_tokens')) {
            onDiagnostic?.({
                type: 'invalid_usage',
                harnessProfileId: 'kimi-k3-coding-openai',
                location,
                field: 'cached_tokens',
                reason: 'invalid_or_exceeds_prompt_tokens',
            });
        }
        const details = isRecord(value.prompt_tokens_details)
            ? value.prompt_tokens_details
            : undefined;
        const detailsCachedTokens = details?.cached_tokens;
        if (isNonnegativeSafeInteger(detailsCachedTokens)
            && detailsCachedTokens <= promptTokens) {
            cacheReadInputTokens = detailsCachedTokens;
        }
        else if (details && hasOwn(details, 'cached_tokens')) {
            onDiagnostic?.({
                type: 'invalid_usage',
                harnessProfileId: 'kimi-k3-coding-openai',
                location,
                field: 'prompt_tokens_details.cached_tokens',
                reason: 'invalid_or_exceeds_prompt_tokens',
            });
        }
    }
    return {
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        ...(cacheReadInputTokens !== undefined
            ? { cacheReadInputTokens }
            : {}),
    };
}
function extractKimiUsage(chunk, onDiagnostic) {
    if (hasOwn(chunk, 'usage') && chunk.usage != null) {
        const topLevel = normalizeKimiUsageSnapshot(chunk.usage, 'top_level', onDiagnostic);
        if (topLevel) {
            return topLevel;
        }
    }
    const choices = chunk.choices;
    if (!Array.isArray(choices) || !isRecord(choices[0])) {
        return undefined;
    }
    if (!hasOwn(choices[0], 'usage') || choices[0].usage == null) {
        return undefined;
    }
    return normalizeKimiUsageSnapshot(choices[0].usage, 'choices_0', onDiagnostic);
}
export const KIMI_K3_CODING_OPENAI_HARNESS_PROFILE = Object.freeze({
    id: 'kimi-k3-coding-openai',
    normalizeToolSchema: normalizeKimiToolSchema,
    serializeReasoning: serializeKimiReasoning,
    encodeCacheKey: (cacheKey) => ({ prompt_cache_key: cacheKey }),
    extractUsage: extractKimiUsage,
    shouldOmitAssistantContent: ({ hasToolCalls, text }) => (hasToolCalls && text.trim().length === 0),
});
export function observeReasoningDialect(state, delta) {
    const hasReasoningContent = Object.prototype.hasOwnProperty.call(delta, 'reasoning_content');
    const hasReasoning = Object.prototype.hasOwnProperty.call(delta, 'reasoning');
    const reasoningContent = hasReasoningContent
        ? delta.reasoning_content
        : undefined;
    let candidate;
    if (hasReasoningContent && typeof reasoningContent === 'string') {
        candidate = 'reasoning_content';
    }
    else if ((!hasReasoningContent || reasoningContent === null)
        && hasReasoning
        && typeof delta.reasoning === 'string') {
        candidate = 'reasoning';
    }
    if (!candidate) {
        return {};
    }
    if (!state.learned) {
        state.current = candidate;
        state.learned = true;
        return {};
    }
    if (state.current === candidate) {
        return {};
    }
    return {
        conflict: {
            previous: state.current,
            candidate,
        },
    };
}
function buildIdentityFingerprint(identity, profile) {
    return JSON.stringify([
        identity.providerId,
        identity.providerType,
        identity.protocol,
        identity.canonicalBaseUrl ?? '',
        identity.wireModel,
        [...identity.capabilities].sort(),
        profile.id,
    ]);
}
export function resolveKimiHarnessFeatureFlags(env) {
    return Object.freeze({
        normalizeToolSchema: true,
        normalizeUsage: true,
        omitEmptyAssistantContent: true,
        promptCacheKey: env.XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE === '1',
        preservedThinking: env.XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING === '1',
    });
}
export function isKimiK3CodingHarnessBinding(identity) {
    return identity.providerId === 'kimi'
        && identity.providerType === 'first_party'
        && identity.protocol === 'openai_legacy'
        && identity.wireModel === 'k3'
        && isOfficialKimiK3OpenAIEndpoint(identity.canonicalBaseUrl);
}
export function resolveModelHarnessProfile(identity) {
    return isKimiK3CodingHarnessBinding(identity)
        ? KIMI_K3_CODING_OPENAI_HARNESS_PROFILE
        : GENERIC_OPENAI_HARNESS_PROFILE;
}
export function buildOpenAIHarnessContext(input) {
    const identity = Object.freeze({
        ...input.identity,
        canonicalBaseUrl: canonicalizeOfficialKimiK3OpenAIEndpoint(input.identity.canonicalBaseUrl),
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
    const profile = resolveModelHarnessProfile(identity);
    return Object.freeze({
        identity,
        profile,
        identityFingerprint: buildIdentityFingerprint(identity, profile),
        flags: input.flags,
        ...(runtimeOptions ? { runtimeOptions } : {}),
        runtimeCapabilities,
    });
}
