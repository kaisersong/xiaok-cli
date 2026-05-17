import type { Config } from '../../types.js';
export interface ResolvedProviderTransport {
    providerId: string;
    apiKey: string;
    baseUrl?: string;
    headers: Record<string, string>;
}
export declare function resolveProviderApiKey(config: Config, providerId: string): string;
export declare function resolveProviderTransport(config: Config, providerId: string): ResolvedProviderTransport;
