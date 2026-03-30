import Anthropic from '@anthropic-ai/sdk';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';
import type { ModelInvocationOptions } from '../runtime/model-capabilities.js';
export declare class ClaudeAdapter implements ModelAdapter {
    client: Anthropic;
    private model;
    constructor(apiKey: string, model?: string, baseUrl?: string);
    getModelName(): string;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string, options?: ModelInvocationOptions): AsyncIterable<StreamChunk>;
}
