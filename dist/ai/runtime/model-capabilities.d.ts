import type { Message, ModelAdapter, ToolDefinition } from '../../types.js';
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
    promptCache?: PromptCacheSegments;
}
export interface ModelCapabilities {
    contextLimit: number;
    compactThreshold: number;
    supportsPromptCaching: boolean;
    supportsImageInput: boolean;
}
export interface CapabilityAwareAdapter extends ModelAdapter {
    getCapabilities?(): Partial<ModelCapabilities>;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string, options?: ModelInvocationOptions): AsyncIterable<import('../../types.js').StreamChunk>;
}
export declare const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities;
export declare function resolveModelCapabilities(model: string): ModelCapabilities;
export declare function resolveModelCapabilities(adapter: ModelAdapter): ModelCapabilities;
export declare function buildPromptCacheSegments(systemPrompt: string, tools: ToolDefinition[], messages: Message[]): PromptCacheSegments;
