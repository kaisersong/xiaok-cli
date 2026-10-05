import type { Message, ModelAdapter, ToolDefinition } from '../../types.js';
import type { ProviderConversationAuthorization } from './provider-conversation-authorization.js';
import type { ProviderDisclosureContext } from '../../runtime/sol-pi/provider-disclosure.js';
export interface CacheControl {
    type: 'ephemeral';
}
export interface SystemPromptBlock {
    type: 'text';
    text: string;
    cache_control?: CacheControl;
}
export type CachedToolDefinition = ToolDefinition & {
    cache_control?: CacheControl;
};
export interface PromptCacheSegments {
    systemPrompt: SystemPromptBlock[];
    tools: CachedToolDefinition[];
    messages: Message[];
}
export interface ModelInvocationOptions {
    /** Host-created single-attempt capability; never restored from serialized state. */
    semanticSummaryAttempt?: import('../../runtime/sol-pi/semantic-summary-attempt.js').SemanticSummaryAttempt;
    /** Exact output reserve used by both the request preview and the actual SDK. */
    semanticSummaryOutputTokens?: number;
    providerDisclosure?: ProviderDisclosureContext;
    promptCache?: PromptCacheSegments;
    cacheKey?: string;
    providerConversationAuthorization?: ProviderConversationAuthorization;
}
export interface StreamOptions extends ModelInvocationOptions {
    signal?: AbortSignal;
}
export interface RunInvocationContext {
    cacheKey?: string;
}
export interface ModelCapabilities {
    contextLimit: number;
    compactThreshold: number;
    supportsPromptCaching: boolean;
    supportsImageInput: boolean;
}
export interface CapabilityAwareAdapter extends ModelAdapter {
    getCapabilities?(): Partial<ModelCapabilities>;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string, options?: StreamOptions): AsyncIterable<import('../../types.js').StreamChunk>;
}
export declare const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities;
export declare function modelCapabilitiesFromFlags(capabilities?: string[]): Partial<ModelCapabilities>;
export declare function resolveModelCapabilities(model: string): ModelCapabilities;
export declare function resolveModelCapabilities(adapter: ModelAdapter): ModelCapabilities;
export declare function buildPromptCacheSegments(systemPromptOrSegments: string | Array<{
    text: string;
    cacheable: boolean;
}>, tools: ToolDefinition[], messages: Message[]): PromptCacheSegments;
