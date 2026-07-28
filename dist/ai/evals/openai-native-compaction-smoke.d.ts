import { type OpenAINativeUsage, type OpenAIResponseInputItem, type OpenAIResponseTool } from '../adapters/openai-responses-native.js';
declare const SMOKE_SUITE_VERSION: "openai-native-compaction-smoke-v1";
export type OpenAINativeCompactionSmokeStatus = 'passed' | 'failed' | 'live_capability_smoke_missing';
export interface OpenAINativeCompactionSmokeRequestEvidence {
    phase: 'initial' | 'compact' | 'continuation';
    clientRequestId: string;
    responseId: string;
    createdAt: number;
    usage: OpenAINativeUsage;
    elapsedMs: number;
}
export interface OpenAINativeCompactionSmokeEvidence {
    schemaVersion: 1;
    suiteVersion: typeof SMOKE_SUITE_VERSION;
    generatedAt: string;
    status: OpenAINativeCompactionSmokeStatus;
    modelFingerprint: string;
    originFingerprint: string;
    accountProjectFingerprint?: string;
    requests: OpenAINativeCompactionSmokeRequestEvidence[];
    totalUsage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
    };
    elapsedMs: number;
    failureClass?: string;
    failurePhase?: OpenAINativeCompactionSmokeRequestEvidence['phase'];
}
export interface RunOpenAINativeCompactionSmokeParams {
    apiKey?: string;
    baseUrl: string;
    model: string;
    fixture: OpenAINativeCompactionSmokeFixture;
    accountProjectFingerprint?: string;
    organization?: string;
    project?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}
export interface OpenAINativeCompactionSmokeFixture {
    initialInput: ReadonlyArray<OpenAIResponseInputItem>;
    tools: ReadonlyArray<OpenAIResponseTool>;
    fixedToolOutputs: Readonly<Record<string, string>>;
    nextUserItem: OpenAIResponseInputItem;
}
export declare function createDefaultOpenAINativeCompactionSmokeFixture(): OpenAINativeCompactionSmokeFixture;
export declare function runOpenAINativeCompactionSmoke(params: RunOpenAINativeCompactionSmokeParams): Promise<OpenAINativeCompactionSmokeEvidence>;
export {};
