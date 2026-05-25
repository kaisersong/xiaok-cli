import type { ModelAdapter, Message, StreamChunk, ToolDefinition } from '../../types.js';
import type { ModelCapabilities } from '../runtime/model-capabilities.js';
export declare class OpenAIResponsesAdapter implements ModelAdapter {
    private readonly apiKey;
    private readonly baseUrl?;
    private readonly defaultHeaders?;
    private readonly capabilityOverrides?;
    private model;
    constructor(apiKey: string, model?: string, baseUrl?: string, defaultHeaders?: Record<string, string>, capabilityOverrides?: Partial<ModelCapabilities>);
    getModelName(): string;
    getCapabilities(): Partial<ModelCapabilities>;
    cloneWithModel(model: string): OpenAIResponsesAdapter;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string): AsyncIterable<StreamChunk>;
    private streamOnce;
}
