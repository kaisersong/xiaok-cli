import type { ProviderModelVariant, ProviderProfile } from './types.js';
export declare function getProviderProfile(providerId: string): ProviderProfile | undefined;
export declare function resolveProviderModelVariant(profile: ProviderProfile, wireModel: string): ProviderModelVariant | undefined;
export declare function getProviderModelVariant(providerId: string, wireModel: string): ProviderModelVariant | undefined;
export declare function listProviderProfiles(): ProviderProfile[];
