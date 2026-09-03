import type { Config, LegacyConfig } from '../../types.js';
import type { ModelRuntimeOptions, ProtocolId } from './types.js';
export interface ResolvedModelBinding {
    providerId: string;
    providerType: 'first_party' | 'custom';
    modelId: string;
    wireModel: string;
    protocol: ProtocolId;
    apiKey: string;
    baseUrl?: string;
    headers: Record<string, string>;
    capabilities: string[];
    runtimeOptions?: ModelRuntimeOptions;
}
export declare class MissingProviderApiKeyError extends Error {
    readonly providerId: string;
    readonly code = "missing_provider_api_key";
    constructor(providerId: string, envHint: string);
}
export declare function resolveRuntimeModelBinding(rawConfig: Config | LegacyConfig, requestedModelId?: string): ResolvedModelBinding;
