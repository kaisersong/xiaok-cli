import type { ModelAdapter } from '../types.js';
import type { Config, LegacyConfig } from '../types.js';
import { type ResolvedModelBinding } from './providers/control-plane.js';
import { type OpenAIAdapterInit } from './providers/model-harness-profile.js';
export declare function resolveOpenAICompatibilityHeaders(binding: ResolvedModelBinding): {
    resolvedHeaders: Record<string, string | null>;
    kimiCodingHeadersApplied: boolean;
};
export declare function buildOpenAIAdapterInit(binding: ResolvedModelBinding, env?: Readonly<Record<string, string | undefined>>): OpenAIAdapterInit;
export declare function createAdapterFromBinding(binding: ResolvedModelBinding): ModelAdapter;
export declare function createAdapter(rawConfig: Config | LegacyConfig): ModelAdapter;
