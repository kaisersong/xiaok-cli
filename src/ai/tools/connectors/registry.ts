import type { ConnectorsConfig, ProviderRuntime } from './config.js';
import { evaluateProviderRuntimes } from './config.js';
import { createBraveSearchProvider } from './search/brave.js';
import { createDuckDuckGoSearchProvider } from './search/duckduckgo.js';
import { createFirecrawlSearchProvider } from './search/firecrawl.js';
import { createTavilySearchProvider } from './search/tavily.js';
import { SearchProviderError } from './search/types.js';
import type { SearchHit, SearchProvider, SearchRunInput } from './search/types.js';
import { createBasicFetchProvider } from './fetch/basic.js';
import { createFirecrawlFetchProvider } from './fetch/firecrawl.js';
import { createJinaFetchProvider } from './fetch/jina.js';
import { FetchProviderError } from './fetch/types.js';
import type { FetchProvider, FetchResult, FetchRunInput } from './fetch/types.js';

// Provider registry: turns ConnectorsConfig into concrete providers and runs
// them with deterministic fallback. Both web_search and web_fetch share the
// same shape so tests and call sites stay symmetric.

const FALLBACK_LIMIT = 3; // after N consecutive failures, mark primary invalid

export interface ProviderInjections {
  fetchFn?: typeof fetch;
}

export interface SearchRunOutcome {
  hits: SearchHit[];
  primary: SearchProvider['name'];
  effective: SearchProvider['name'];
  // populated when the registry had to fall back; tool entries surface this.
  fallback?: {
    from: SearchProvider['name'];
    to: SearchProvider['name'];
    reason: string;
  };
}

export interface FetchRunOutcome {
  result: FetchResult;
  primary: FetchProvider['name'];
  effective: FetchProvider['name'];
  fallback?: {
    from: FetchProvider['name'];
    to: FetchProvider['name'];
    reason: string;
  };
}

interface ConnectorRegistryState {
  search: SearchProvider;
  fetch: FetchProvider;
  fallbackSearch: SearchProvider;
  fallbackFetch: FetchProvider;
  searchFailureWindow: SearchProvider['name'][];
  fetchFailureWindow: FetchProvider['name'][];
  invalidSearch: Set<SearchProvider['name']>;
  invalidFetch: Set<FetchProvider['name']>;
  config: ConnectorsConfig;
}

/**
 * In-memory provider registry. Construct once and call apply() whenever the
 * source config changes — never reach into provider internals from the tools.
 *
 * Failure counter is in-memory (resets on process restart) by design: the
 * counter exists to protect users from accidental cost / latency blowups
 * inside a single session, not to drive durable diagnostics.
 */
export class ConnectorRegistry {
  private state: ConnectorRegistryState;

  constructor(config: ConnectorsConfig, private readonly injections: ProviderInjections = {}) {
    this.state = this.buildState(config);
  }

  apply(config: ConnectorsConfig): void {
    this.state = this.buildState(config);
  }

  /** Snapshot used by tools so a single execute call is consistent. */
  getSearchProvider(): SearchProvider {
    return this.state.search;
  }

  getFetchProvider(): FetchProvider {
    return this.state.fetch;
  }

  getConfig(): ConnectorsConfig {
    return this.state.config;
  }

  listProviderRuntimes(): ProviderRuntime[] {
    const base = evaluateProviderRuntimes(this.state.config);
    return base.map((runtime) => {
      if (runtime.runtime_state !== 'ready') return runtime;
      // Reflect runtime-disabled state from failure window.
      if (runtime.provider_name.startsWith('web_search.')) {
        const name = runtime.provider_name as SearchProvider['name'];
        if (this.state.invalidSearch.has(name)) {
          return { ...runtime, runtime_state: 'invalid_config', runtime_reason: 'repeated_failures' };
        }
      } else if (runtime.provider_name.startsWith('web_fetch.')) {
        const name = runtime.provider_name as FetchProvider['name'];
        if (this.state.invalidFetch.has(name)) {
          return { ...runtime, runtime_state: 'invalid_config', runtime_reason: 'repeated_failures' };
        }
      }
      return runtime;
    });
  }

  async runSearch(input: SearchRunInput): Promise<SearchRunOutcome> {
    const primary = this.state.search;
    const fallback = this.state.fallbackSearch;
    const usePrimary = !this.state.invalidSearch.has(primary.name);
    const timedInput = { ...input, signal: input.signal ?? AbortSignal.timeout(30_000) };

    if (usePrimary) {
      try {
        const hits = await runWithAbortSignal(primary.search(timedInput), timedInput.signal);
        this.resetSearchWindow(primary.name);
        return { hits, primary: primary.name, effective: primary.name };
      } catch (error) {
        const reason = describeSearchError(error);
        this.recordSearchFailure(primary.name);
        if (primary.name === fallback.name) {
          // No different fallback — re-throw as a structured error for the tool entry.
          throw error;
        }
        try {
          const hits = await runWithAbortSignal(fallback.search(timedInput), timedInput.signal);
          return {
            hits,
            primary: primary.name,
            effective: fallback.name,
            fallback: { from: primary.name, to: fallback.name, reason },
          };
        } catch {
          // Re-throw the ORIGINAL primary error — that's what the user cares about.
          throw error;
        }
      }
    }

    // Primary already marked invalid in this session — go straight to fallback.
    const hits = await runWithAbortSignal(fallback.search(timedInput), timedInput.signal);
    return {
      hits,
      primary: primary.name,
      effective: fallback.name,
      fallback: { from: primary.name, to: fallback.name, reason: 'invalidated_after_repeated_failures' },
    };
  }

  async runFetch(input: FetchRunInput): Promise<FetchRunOutcome> {
    const primary = this.state.fetch;
    const fallback = this.state.fallbackFetch;
    const usePrimary = !this.state.invalidFetch.has(primary.name);
    const timedInput = { ...input, signal: input.signal ?? AbortSignal.timeout(30_000) };

    if (usePrimary) {
      try {
        const result = await runWithAbortSignal(primary.fetch(timedInput), timedInput.signal);
        this.resetFetchWindow(primary.name);
        return { result, primary: primary.name, effective: primary.name };
      } catch (error) {
        const reason = describeFetchError(error);
        this.recordFetchFailure(primary.name);
        if (primary.name === fallback.name) {
          throw error;
        }
        try {
          const result = await runWithAbortSignal(fallback.fetch(timedInput), timedInput.signal);
          return {
            result,
            primary: primary.name,
            effective: fallback.name,
            fallback: { from: primary.name, to: fallback.name, reason },
          };
        } catch {
          throw error;
        }
      }
    }

    const result = await runWithAbortSignal(fallback.fetch(timedInput), timedInput.signal);
    return {
      result,
      primary: primary.name,
      effective: fallback.name,
      fallback: { from: primary.name, to: fallback.name, reason: 'invalidated_after_repeated_failures' },
    };
  }

  private buildState(config: ConnectorsConfig): ConnectorRegistryState {
    const fallbackSearch = createDuckDuckGoSearchProvider({ fetchFn: this.injections.fetchFn });
    const fallbackFetch = createBasicFetchProvider({ fetchFn: this.injections.fetchFn });
    return {
      config,
      search: this.buildSearchProvider(config, fallbackSearch),
      fetch: this.buildFetchProvider(config, fallbackFetch),
      fallbackSearch,
      fallbackFetch,
      searchFailureWindow: [],
      fetchFailureWindow: [],
      invalidSearch: new Set(),
      invalidFetch: new Set(),
    };
  }

  private buildSearchProvider(config: ConnectorsConfig, fallback: SearchProvider): SearchProvider {
    const fetchFn = this.injections.fetchFn;
    switch (config.search.provider) {
    case 'tavily': {
      const apiKey = config.search.tavilyApiKey?.trim();
      if (!apiKey) return fallback;
      try {
        return createTavilySearchProvider({ apiKey, fetchFn });
      } catch {
        return fallback;
      }
    }
    case 'brave': {
      const apiKey = config.search.braveApiKey?.trim();
      if (!apiKey) return fallback;
      try {
        return createBraveSearchProvider({ apiKey, fetchFn });
      } catch {
        return fallback;
      }
    }
    case 'firecrawl': {
      try {
        return createFirecrawlSearchProvider({
          apiKey: config.search.firecrawlApiKey?.trim() || undefined,
          fetchFn,
        });
      } catch {
        return fallback;
      }
    }
    case 'duckduckgo':
    case 'searxng': // not implemented → use fallback
    default:
      return fallback;
    }
  }

  private buildFetchProvider(config: ConnectorsConfig, fallback: FetchProvider): FetchProvider {
    const fetchFn = this.injections.fetchFn;
    switch (config.fetch.provider) {
    case 'jina':
      return createJinaFetchProvider({ apiKey: config.fetch.jinaApiKey, fetchFn });
    case 'firecrawl':
      return createFirecrawlFetchProvider({
        apiKey: config.fetch.firecrawlApiKey?.trim() || undefined,
        fetchFn,
      });
    case 'basic':
    default:
      return fallback;
    }
  }

  private recordSearchFailure(name: SearchProvider['name']): void {
    const window = this.state.searchFailureWindow;
    window.push(name);
    if (window.length > FALLBACK_LIMIT) {
      window.splice(0, window.length - FALLBACK_LIMIT);
    }
    if (window.length === FALLBACK_LIMIT && window.every((entry) => entry === name)) {
      this.state.invalidSearch.add(name);
    }
  }

  private resetSearchWindow(name: SearchProvider['name']): void {
    this.state.searchFailureWindow = [];
    this.state.invalidSearch.delete(name);
  }

  private recordFetchFailure(name: FetchProvider['name']): void {
    const window = this.state.fetchFailureWindow;
    window.push(name);
    if (window.length > FALLBACK_LIMIT) {
      window.splice(0, window.length - FALLBACK_LIMIT);
    }
    if (window.length === FALLBACK_LIMIT && window.every((entry) => entry === name)) {
      this.state.invalidFetch.add(name);
    }
  }

  private resetFetchWindow(name: FetchProvider['name']): void {
    this.state.fetchFailureWindow = [];
    this.state.invalidFetch.delete(name);
  }
}

function describeSearchError(error: unknown): string {
  if (error instanceof SearchProviderError) {
    const status = error.status ? ` (${error.status})` : '';
    return `${error.kind}${status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function describeFetchError(error: unknown): string {
  if (error instanceof FetchProviderError) {
    const status = error.status ? ` (${error.status})` : '';
    return `${error.kind}${status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function runWithAbortSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(getAbortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(getAbortReason(signal));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function getAbortReason(signal: AbortSignal): unknown {
  if (signal.reason instanceof Error) return signal.reason;
  if (signal.reason) return signal.reason;
  return new DOMException('operation aborted', 'AbortError');
}
