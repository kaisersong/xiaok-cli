import type { ModelReasoningEffort, ModelRuntimeConstraints, ModelRuntimeOptions, ProtocolId } from './types.js';
interface ResolveModelRuntimeOptionsInput {
    protocol: ProtocolId;
    baseUrl?: string;
    wireModel: string;
    catalogOptions?: ModelRuntimeOptions;
    catalogConstraints?: ModelRuntimeConstraints;
    configuredOptions?: ModelRuntimeOptions;
    reasoningEfforts?: ModelReasoningEffort[];
}
interface ResolvedModelRuntimeOptions {
    runtimeOptions?: ModelRuntimeOptions;
    runtimeConstraints?: ModelRuntimeConstraints;
}
export declare function isOfficialKimiK3OpenAIEndpoint(baseUrl?: string): boolean;
export declare function canonicalizeOfficialKimiK3OpenAIEndpoint(baseUrl?: string): string | undefined;
/** Ordered native tiers; for an even count, choose the upper middle tier. */
export declare function getDefaultModelReasoningEffort(efforts: readonly ModelReasoningEffort[]): ModelReasoningEffort | undefined;
export declare function resolveModelRuntimeOptions(input: ResolveModelRuntimeOptionsInput): ResolvedModelRuntimeOptions;
export {};
