import type { ModelRuntimeConstraints, ModelRuntimeOptions, ProtocolId } from './types.js';
interface ResolveModelRuntimeOptionsInput {
    protocol: ProtocolId;
    baseUrl?: string;
    wireModel: string;
    catalogOptions?: ModelRuntimeOptions;
    catalogConstraints?: ModelRuntimeConstraints;
    configuredOptions?: ModelRuntimeOptions;
}
interface ResolvedModelRuntimeOptions {
    runtimeOptions?: ModelRuntimeOptions;
    runtimeConstraints?: ModelRuntimeConstraints;
}
export declare function isOfficialKimiK3OpenAIEndpoint(baseUrl?: string): boolean;
export declare function canonicalizeOfficialKimiK3OpenAIEndpoint(baseUrl?: string): string | undefined;
export declare function resolveModelRuntimeOptions(input: ResolveModelRuntimeOptionsInput): ResolvedModelRuntimeOptions;
export {};
