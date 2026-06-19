// Shared connectors config used by CLI runtime and desktop main process.
// Same schema is consumed by both; only the persistence layer differs
// (env / settings.json for CLI, encrypted store for desktop).

export type SearchProviderName = 'duckduckgo' | 'tavily' | 'brave' | 'firecrawl' | 'searxng';
export type FetchProviderName = 'basic' | 'jina' | 'firecrawl';

export interface SearchConnectorConfig {
  provider: SearchProviderName;
  tavilyApiKey?: string;
  braveApiKey?: string;
  firecrawlApiKey?: string;
  searxngBaseUrl?: string; // reserved, v1 not implemented
}

export interface FetchConnectorConfig {
  provider: FetchProviderName;
  jinaApiKey?: string; // optional; Jina works keyless
  firecrawlApiKey?: string;
  firecrawlBaseUrl?: string;
}

export interface ConnectorsConfig {
  search: SearchConnectorConfig;
  fetch: FetchConnectorConfig;
}

export const DEFAULT_CONNECTORS_CONFIG: ConnectorsConfig = Object.freeze({
  search: { provider: 'duckduckgo' as SearchProviderName },
  fetch: { provider: 'basic' as FetchProviderName },
}) as ConnectorsConfig;

export const SEARCH_PROVIDER_NAMES: readonly SearchProviderName[] = ['duckduckgo', 'tavily', 'brave', 'firecrawl', 'searxng'];
export const FETCH_PROVIDER_NAMES: readonly FetchProviderName[] = ['basic', 'jina', 'firecrawl'];

const NOT_IMPLEMENTED_SEARCH: ReadonlySet<SearchProviderName> = new Set(['searxng']);
const NOT_IMPLEMENTED_FETCH: ReadonlySet<FetchProviderName> = new Set();

export function isSearchProviderImplemented(name: SearchProviderName): boolean {
  return !NOT_IMPLEMENTED_SEARCH.has(name);
}

export function isFetchProviderImplemented(name: FetchProviderName): boolean {
  return !NOT_IMPLEMENTED_FETCH.has(name);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function pickString(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/**
 * Normalize an arbitrary input into a ConnectorsConfig.
 * Unknown providers fall back to defaults; unknown fields are dropped.
 * Empty strings are coerced to undefined.
 */
export function normalizeConnectorsConfig(input: unknown): ConnectorsConfig {
  if (!input || typeof input !== 'object') {
    return cloneDefaultConnectorsConfig();
  }
  const obj = input as Record<string, unknown>;
  const search = obj.search && typeof obj.search === 'object' ? (obj.search as Record<string, unknown>) : {};
  const fetch = obj.fetch && typeof obj.fetch === 'object' ? (obj.fetch as Record<string, unknown>) : {};
  const searchProviderRaw = pickString(search.provider) as SearchProviderName | undefined;
  const fetchProviderRaw = pickString(fetch.provider) as FetchProviderName | undefined;
  const searchProvider: SearchProviderName = searchProviderRaw && SEARCH_PROVIDER_NAMES.includes(searchProviderRaw)
    ? searchProviderRaw
    : 'duckduckgo';
  const fetchProvider: FetchProviderName = fetchProviderRaw && FETCH_PROVIDER_NAMES.includes(fetchProviderRaw)
    ? fetchProviderRaw
    : 'basic';
  return {
    search: {
      provider: searchProvider,
      tavilyApiKey: pickString(search.tavilyApiKey),
      braveApiKey: pickString(search.braveApiKey),
      firecrawlApiKey: pickString(search.firecrawlApiKey),
      searxngBaseUrl: pickString(search.searxngBaseUrl),
    },
    fetch: {
      provider: fetchProvider,
      jinaApiKey: pickString(fetch.jinaApiKey),
      firecrawlApiKey: pickString(fetch.firecrawlApiKey),
      firecrawlBaseUrl: pickString(fetch.firecrawlBaseUrl),
    },
  };
}

export function cloneDefaultConnectorsConfig(): ConnectorsConfig {
  return {
    search: { ...DEFAULT_CONNECTORS_CONFIG.search },
    fetch: { ...DEFAULT_CONNECTORS_CONFIG.fetch },
  };
}

/**
 * Resolve config for CLI runtime.
 *
 * Precedence: env > base (caller-provided settings.json snapshot) > defaults.
 * Desktop must NOT call this; desktop owns its own store and ignores env to
 * avoid two sources of truth (see web-search-fetch-providers design doc).
 */
export function resolveCliConnectorsConfig(
  base: Partial<ConnectorsConfig> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ConnectorsConfig {
  const normalized = normalizeConnectorsConfig(base);

  const envSearchProvider = pickString(env.XIAOK_SEARCH_PROVIDER) as SearchProviderName | undefined;
  if (envSearchProvider && SEARCH_PROVIDER_NAMES.includes(envSearchProvider)) {
    normalized.search.provider = envSearchProvider;
  }
  const tavilyKey = pickString(env.TAVILY_API_KEY);
  if (tavilyKey) normalized.search.tavilyApiKey = tavilyKey;
  const braveKey = pickString(env.BRAVE_API_KEY);
  if (braveKey) normalized.search.braveApiKey = braveKey;
  const firecrawlKey = pickString(env.FIRECRAWL_API_KEY);
  if (firecrawlKey) {
    normalized.search.firecrawlApiKey = firecrawlKey;
    normalized.fetch.firecrawlApiKey = firecrawlKey;
  }

  const envFetchProvider = pickString(env.XIAOK_FETCH_PROVIDER) as FetchProviderName | undefined;
  if (envFetchProvider && FETCH_PROVIDER_NAMES.includes(envFetchProvider)) {
    normalized.fetch.provider = envFetchProvider;
  }
  const jinaKey = pickString(env.JINA_API_KEY);
  if (jinaKey) normalized.fetch.jinaApiKey = jinaKey;

  return normalized;
}

export type ProviderRuntimeState =
  | 'ready'
  | 'missing_config'
  | 'invalid_config'
  | 'decrypt_failed'
  | 'inactive'
  | 'not_implemented';

export interface ProviderRuntime {
  provider_name: string;
  runtime_state: ProviderRuntimeState;
  runtime_reason?: string;
}

/**
 * Compute the runtime state of every candidate provider given a config.
 * Used by both desktop (for IPC) and CLI (for diagnostics).
 */
export function evaluateProviderRuntimes(config: ConnectorsConfig): ProviderRuntime[] {
  const searchSelected = config.search.provider;
  const fetchSelected = config.fetch.provider;
  return [
    searchRuntime('duckduckgo', searchSelected, config),
    searchRuntime('tavily', searchSelected, config),
    searchRuntime('brave', searchSelected, config),
    searchRuntime('firecrawl', searchSelected, config),
    searchRuntime('searxng', searchSelected, config),
    fetchRuntime('basic', fetchSelected, config),
    fetchRuntime('jina', fetchSelected, config),
    fetchRuntime('firecrawl', fetchSelected, config),
  ];
}

function searchRuntime(
  name: SearchProviderName,
  selected: SearchProviderName,
  config: ConnectorsConfig,
): ProviderRuntime {
  const provider_name = `web_search.${name}`;
  if (!isSearchProviderImplemented(name)) {
    return { provider_name, runtime_state: 'not_implemented', runtime_reason: 'v1_not_supported' };
  }
  if (name !== selected) {
    return { provider_name, runtime_state: 'inactive' };
  }
  if (name === 'duckduckgo' || name === 'firecrawl') {
    return { provider_name, runtime_state: 'ready' };
  }
  if (name === 'tavily' && !config.search.tavilyApiKey) {
    return { provider_name, runtime_state: 'missing_config', runtime_reason: 'missing_api_key' };
  }
  if (name === 'brave' && !config.search.braveApiKey) {
    return { provider_name, runtime_state: 'missing_config', runtime_reason: 'missing_api_key' };
  }
  return { provider_name, runtime_state: 'ready' };
}

function fetchRuntime(
  name: FetchProviderName,
  selected: FetchProviderName,
  config: ConnectorsConfig,
): ProviderRuntime {
  const provider_name = `web_fetch.${name}`;
  if (!isFetchProviderImplemented(name)) {
    return { provider_name, runtime_state: 'not_implemented', runtime_reason: 'v1_not_supported' };
  }
  if (name !== selected) {
    return { provider_name, runtime_state: 'inactive' };
  }
  // jina works keyless, so it is always ready when selected
  return { provider_name, runtime_state: 'ready' };
}
