import OpenAI from 'openai';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';
import type { ModelCapabilities, ModelInvocationOptions } from '../runtime/model-capabilities.js';
export declare class OpenAIAdapter implements ModelAdapter {
    client: OpenAI;
    private readonly apiKey;
    private readonly baseUrl?;
    private readonly defaultHeaders?;
    private readonly capabilityOverrides?;
    private readonly httpAgent;
    private model;
    constructor(apiKey: string, model?: string, baseUrl?: string, defaultHeaders?: Record<string, string>, capabilityOverrides?: Partial<ModelCapabilities>);
    getModelName(): string;
    getCapabilities(): Partial<ModelCapabilities>;
    dispose(): void;
    cloneWithModel(model: string): OpenAIAdapter;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string, options?: ModelInvocationOptions): AsyncIterable<StreamChunk>;
    private streamOnce;
}
