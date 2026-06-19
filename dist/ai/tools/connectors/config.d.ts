export type SearchProviderName = 'duckduckgo' | 'tavily' | 'brave' | 'firecrawl' | 'searxng';
export type FetchProviderName = 'basic' | 'jina' | 'firecrawl';
export interface SearchConnectorConfig {
    provider: SearchProviderName;
    tavilyApiKey?: string;
    braveApiKey?: string;
    firecrawlApiKey?: string;
    searxngBaseUrl?: string;
}
export interface FetchConnectorConfig {
    provider: FetchProviderName;
    jinaApiKey?: string;
    firecrawlApiKey?: string;
    firecrawlBaseUrl?: string;
}
export interface ConnectorsConfig {
    search: SearchConnectorConfig;
    fetch: FetchConnectorConfig;
}
export declare const DEFAULT_CONNECTORS_CONFIG: ConnectorsConfig;
export declare const SEARCH_PROVIDER_NAMES: readonly SearchProviderName[];
export declare const FETCH_PROVIDER_NAMES: readonly FetchProviderName[];
export declare function isSearchProviderImplemented(name: SearchProviderName): boolean;
export declare function isFetchProviderImplemented(name: FetchProviderName): boolean;
/**
 * Normalize an arbitrary input into a ConnectorsConfig.
 * Unknown providers fall back to defaults; unknown fields are dropped.
 * Empty strings are coerced to undefined.
 */
export declare function normalizeConnectorsConfig(input: unknown): ConnectorsConfig;
export declare function cloneDefaultConnectorsConfig(): ConnectorsConfig;
/**
 * Resolve config for CLI runtime.
 *
 * Precedence: env > base (caller-provided settings.json snapshot) > defaults.
 * Desktop must NOT call this; desktop owns its own store and ignores env to
 * avoid two sources of truth (see web-search-fetch-providers design doc).
 */
export declare function resolveCliConnectorsConfig(base: Partial<ConnectorsConfig> | undefined, env?: NodeJS.ProcessEnv): ConnectorsConfig;
export type ProviderRuntimeState = 'ready' | 'missing_config' | 'invalid_config' | 'decrypt_failed' | 'inactive' | 'not_implemented';
export interface ProviderRuntime {
    provider_name: string;
    runtime_state: ProviderRuntimeState;
    runtime_reason?: string;
}
/**
 * Compute the runtime state of every candidate provider given a config.
 * Used by both desktop (for IPC) and CLI (for diagnostics).
 */
export declare function evaluateProviderRuntimes(config: ConnectorsConfig): ProviderRuntime[];
