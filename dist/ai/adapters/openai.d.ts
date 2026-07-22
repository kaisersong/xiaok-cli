import OpenAI from 'openai';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';
import type { ModelCapabilities, StreamOptions } from '../runtime/model-capabilities.js';
import type { ModelRuntimeOptions } from '../providers/types.js';
type OpenAICapabilityOverrides = Partial<Pick<ModelCapabilities, 'supportsPromptCaching' | 'supportsImageInput'>>;
export declare class OpenAIAdapter implements ModelAdapter {
    client: OpenAI;
    private readonly apiKey;
    private readonly baseUrl?;
    private readonly defaultHeaders?;
    private readonly capabilityOverrides;
    private readonly runtimeOptions?;
    private readonly httpAgent;
    private model;
    constructor(apiKey: string, model?: string, baseUrl?: string, defaultHeaders?: Record<string, string>, capabilityOverrides?: OpenAICapabilityOverrides, runtimeOptions?: ModelRuntimeOptions);
    getModelName(): string;
    getCapabilities(): Partial<ModelCapabilities>;
    dispose(): void;
    cloneWithModel(model: string): OpenAIAdapter;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string, options?: StreamOptions): AsyncIterable<StreamChunk>;
    private streamOnce;
}
export {};
