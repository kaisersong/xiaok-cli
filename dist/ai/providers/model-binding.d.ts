import type { Config } from '../../types.js';
import type { ModelConfigEntry, ProviderConfig } from './types.js';
export interface ConfiguredModelBinding {
    modelId: string;
    providerId: string;
    modelEntry: ModelConfigEntry;
    providerConfig: ProviderConfig;
}
export declare function resolveConfiguredModelBinding(config: Config, requestedModelId?: string): ConfiguredModelBinding;
