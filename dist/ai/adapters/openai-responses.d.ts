import type { ModelAdapter, Message, StreamChunk, ToolDefinition } from '../../types.js';
export declare class OpenAIResponsesAdapter implements ModelAdapter {
    private readonly apiKey;
    private readonly baseUrl?;
    private readonly defaultHeaders?;
    private model;
    constructor(apiKey: string, model?: string, baseUrl?: string, defaultHeaders?: Record<string, string>);
    getModelName(): string;
    cloneWithModel(model: string): OpenAIResponsesAdapter;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string): AsyncIterable<StreamChunk>;
    private streamOnce;
}
