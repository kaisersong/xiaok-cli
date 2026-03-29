import Anthropic from '@anthropic-ai/sdk';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';
export declare class ClaudeAdapter implements ModelAdapter {
    client: Anthropic;
    private model;
    constructor(apiKey: string, model?: string, baseUrl?: string);
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string): AsyncIterable<StreamChunk>;
}
