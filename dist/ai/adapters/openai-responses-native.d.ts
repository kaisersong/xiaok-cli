export type OpenAIResponseInputItem = Readonly<Record<string, unknown>>;
export type OpenAIResponseTool = Readonly<Record<string, unknown>>;
export interface OpenAINativeUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
}
export interface OpenAINativeResponseResult {
    responseId: string;
    createdAt: number;
    output: ReadonlyArray<Record<string, unknown>>;
    usage: OpenAINativeUsage;
    elapsedMs: number;
}
interface OpenAINativeRequestParams {
    apiKey: string;
    baseUrl: string;
    model: string;
    input: ReadonlyArray<OpenAIResponseInputItem>;
    organization?: string;
    project?: string;
    requestId?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}
export interface CreateStatelessOpenAIResponseParams extends OpenAINativeRequestParams {
    tools?: ReadonlyArray<OpenAIResponseTool>;
}
export type CompactOpenAIResponsesContextParams = OpenAINativeRequestParams;
export declare function createStatelessOpenAIResponse(params: CreateStatelessOpenAIResponseParams): Promise<OpenAINativeResponseResult>;
export declare function compactOpenAIResponsesContext(params: CompactOpenAIResponsesContextParams): Promise<OpenAINativeResponseResult>;
export {};
