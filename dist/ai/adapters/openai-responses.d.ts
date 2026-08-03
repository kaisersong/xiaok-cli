import type { ModelAdapter, Message, StreamChunk, ToolDefinition } from '../../types.js';
import type { ModelCapabilities, StreamOptions } from '../runtime/model-capabilities.js';
import { type AdapterCatalogIdentity } from './catalog-identity.js';
export declare class OpenAIResponsesAdapter implements ModelAdapter {
    private readonly apiKey;
    private readonly baseUrl?;
    private readonly defaultHeaders?;
    private readonly capabilityOverrides?;
    private readonly catalogIdentity?;
    private model;
    constructor(apiKey: string, model?: string, baseUrl?: string, defaultHeaders?: Record<string, string>, capabilityOverrides?: Partial<ModelCapabilities>, catalogIdentity?: AdapterCatalogIdentity);
    getModelName(): string;
    getCapabilities(): Partial<ModelCapabilities>;
    cloneWithModel(model: string): OpenAIResponsesAdapter;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string, options?: StreamOptions): AsyncIterable<StreamChunk>;
    private streamOnce;
}
export declare function isGlobalPublicOpenAIResponsesBaseUrl(baseUrl?: string): boolean;
export declare function buildResponsesInput(messages: Message[], systemPrompt: string): Array<Record<string, unknown>>;
