import OpenAI from 'openai';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';
import type { ModelCapabilities, StreamOptions } from '../runtime/model-capabilities.js';
import { type OpenAIAdapterInit } from '../providers/model-harness-profile.js';
export declare class OpenAIAdapter implements ModelAdapter {
    client: OpenAI;
    private readonly apiKey;
    private readonly resolvedHeaders?;
    private readonly kimiCodingHeadersApplied;
    private readonly onUsageDiagnostic;
    readonly harnessContext: OpenAIAdapterInit['harnessContext'];
    private reasoningDialectState;
    constructor(init: OpenAIAdapterInit);
    getModelName(): string;
    getHarnessProfileId(): string;
    /**
     * Read-only identity view. Authorization ownership is established by the
     * concrete adapter instance, never by a caller-provided string or registrar.
     */
    getOwnedHarnessProfileId(): OpenAIAdapterInit['harnessContext']['profile']['id'] | undefined;
    getCapabilities(): Readonly<ModelCapabilities>;
    dispose(): void;
    cloneWithModel(newWireModel: string): OpenAIAdapter;
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string, options?: StreamOptions): AsyncIterable<StreamChunk>;
    private streamOnce;
}
