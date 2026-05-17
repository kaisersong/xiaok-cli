import type { Config, LegacyConfig } from '../../types.js';
import type { ProtocolId } from './types.js';
export interface ResolvedModelBinding {
    providerId: string;
    modelId: string;
    wireModel: string;
    protocol: ProtocolId;
    apiKey: string;
    baseUrl?: string;
    headers: Record<string, string>;
    capabilities: string[];
}
export declare function resolveRuntimeModelBinding(rawConfig: Config | LegacyConfig, requestedModelId?: string): ResolvedModelBinding;
