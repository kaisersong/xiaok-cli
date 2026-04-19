import OpenAI from 'openai';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';
import type { ModelInvocationOptions } from '../runtime/model-capabilities.js';
export declare class OpenAIAdapter implements ModelAdapter {
    client: OpenAI;
    private readonly apiKey;
    private readonly baseUrl?;
    private readonly defaultHeaders?;
    private model;
    constructor(apiKey: string, model?: string, baseUrl?: string, defaultHeaders?: Record<string, string>);
    getModelName(): string;
    cloneWithModel(model: string): OpenAIAdapter;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string, _options?: ModelInvocationOptions): AsyncIterable<StreamChunk>;
}
