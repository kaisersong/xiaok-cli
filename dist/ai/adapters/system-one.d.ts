import type { ModelAdapter, Message, StreamChunk, ToolDefinition } from '../../types.js';
import type { ModelCapabilities, StreamOptions } from '../runtime/model-capabilities.js';
import { type AdapterCatalogIdentity } from './catalog-identity.js';
export interface SystemOneAnswer {
    type?: string;
    choice?: string;
    /** Score 答案：跨等级的概率加权值，可以落在两级之间。 */
    score?: number;
    noul?: number;
    confidence?: number;
    probabilities?: Record<string, number>;
}
export interface SystemOneResponse {
    model?: string;
    answers?: Record<string, SystemOneAnswer>;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
    };
}
export interface SystemOneInit {
    apiKey: string;
    baseUrl?: string;
    model: string;
    headers?: Record<string, string>;
    capabilityOverrides?: Partial<ModelCapabilities>;
    catalogIdentity?: AdapterCatalogIdentity;
}
export interface SystemOneRequest {
    model: string;
    state: string;
    questions: Record<string, Record<string, unknown>>;
}
/** 取最后一条非空 user 文本；没有 user 文本时回退 systemPrompt。 */
export declare function extractSystemOneState(messages: Message[], systemPrompt: string): string;
export declare function buildSystemOneQuestions(tools: ToolDefinition[], state: string): Record<string, Record<string, unknown>>;
export declare function buildSystemOneRequest(model: string, messages: Message[], tools: ToolDefinition[], systemPrompt: string): SystemOneRequest;
export declare class SystemOneAdapter implements ModelAdapter {
    private readonly apiKey;
    private readonly baseUrl?;
    private readonly defaultHeaders?;
    private readonly capabilityOverrides?;
    private readonly catalogIdentity?;
    private model;
    constructor(init: SystemOneInit);
    getModelName(): string;
    getCapabilities(): Partial<ModelCapabilities>;
    cloneWithModel(model: string): SystemOneAdapter;
    private endpoint;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string, options?: StreamOptions): AsyncIterable<StreamChunk>;
}
