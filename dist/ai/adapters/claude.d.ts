import type Anthropic from '@anthropic-ai/sdk';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';
import type { ModelCapabilities, StreamOptions } from '../runtime/model-capabilities.js';
export declare class ClaudeAdapter implements ModelAdapter {
    client?: Anthropic;
    private readonly apiKey;
    private readonly baseUrl?;
    private readonly capabilityOverrides?;
    private model;
    private clientPromise;
    constructor(apiKey: string, model?: string, baseUrl?: string, capabilityOverrides?: Partial<ModelCapabilities>);
    getModelName(): string;
    getCapabilities(): Partial<ModelCapabilities>;
    cloneWithModel(model: string): ClaudeAdapter;
    private getClient;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string, options?: StreamOptions): AsyncIterable<StreamChunk>;
    private streamOnce;
}
