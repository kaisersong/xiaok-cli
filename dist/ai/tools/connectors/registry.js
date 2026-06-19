import { evaluateProviderRuntimes } from './config.js';
import { createBraveSearchProvider } from './search/brave.js';
import { createDuckDuckGoSearchProvider } from './search/duckduckgo.js';
import { createFirecrawlSearchProvider } from './search/firecrawl.js';
import { createTavilySearchProvider } from './search/tavily.js';
import { SearchProviderError } from './search/types.js';
import { createBasicFetchProvider } from './fetch/basic.js';
import { createFirecrawlFetchProvider } from './fetch/firecrawl.js';
import { createJinaFetchProvider } from './fetch/jina.js';
import { FetchProviderError } from './fetch/types.js';
// Provider registry: turns ConnectorsConfig into concrete providers and runs
// them with deterministic fallback. Both web_search and web_fetch share the
// same shape so tests and call sites stay symmetric.
const FALLBACK_LIMIT = 3; // after N consecutive failures, mark primary invalid
/**
 * In-memory provider registry. Construct once and call apply() whenever the
 * source config changes — never reach into provider internals from the tools.
 *
 * Failure counter is in-memory (resets on process restart) by design: the
 * counter exists to protect users from accidental cost / latency blowups
 * inside a single session, not to drive durable diagnostics.
 */
export class ConnectorRegistry {
    injections;
    state;
    constructor(config, injections = {}) {
        this.injections = injections;
        this.state = this.buildState(config);
    }
    apply(config) {
        this.state = this.buildState(config);
    }
    /** Snapshot used by tools so a single execute call is consistent. */
    getSearchProvider() {
        return this.state.search;
    }
    getFetchProvider() {
        return this.state.fetch;
    }
    getConfig() {
        return this.state.config;
    }
    listProviderRuntimes() {
        const base = evaluateProviderRuntimes(this.state.config);
        return base.map((runtime) => {
            if (runtime.runtime_state !== 'ready')
                return runtime;
            // Reflect runtime-disabled state from failure window.
            if (runtime.provider_name.startsWith('web_search.')) {
                const name = runtime.provider_name;
                if (this.state.invalidSearch.has(name)) {
                    return { ...runtime, runtime_state: 'invalid_config', runtime_reason: 'repeated_failures' };
                }
            }
            else if (runtime.provider_name.startsWith('web_fetch.')) {
                const name = runtime.provider_name;
                if (this.state.invalidFetch.has(name)) {
                    return { ...runtime, runtime_state: 'invalid_config', runtime_reason: 'repeated_failures' };
                }
            }
            return runtime;
        });
    }
    async runSearch(input) {
        const primary = this.state.search;
        const fallback = this.state.fallbackSearch;
        const usePrimary = !this.state.invalidSearch.has(primary.name);
        const timedInput = { ...input, signal: input.signal ?? AbortSignal.timeout(30_000) };
        if (usePrimary) {
            try {
                const hits = await runWithAbortSignal(primary.search(timedInput), timedInput.signal);
                this.resetSearchWindow(primary.name);
                return { hits, primary: primary.name, effective: primary.name };
            }
            catch (error) {
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
                }
                catch {
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
    async runFetch(input) {
        const primary = this.state.fetch;
        const fallback = this.state.fallbackFetch;
        const usePrimary = !this.state.invalidFetch.has(primary.name);
        const timedInput = { ...input, signal: input.signal ?? AbortSignal.timeout(30_000) };
        if (usePrimary) {
            try {
                const result = await runWithAbortSignal(primary.fetch(timedInput), timedInput.signal);
                this.resetFetchWindow(primary.name);
                return { result, primary: primary.name, effective: primary.name };
            }
            catch (error) {
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
                }
                catch {
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
    buildState(config) {
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
    buildSearchProvider(config, fallback) {
        const fetchFn = this.injections.fetchFn;
        switch (config.search.provider) {
            case 'tavily': {
                const apiKey = config.search.tavilyApiKey?.trim();
                if (!apiKey)
                    return fallback;
                try {
                    return createTavilySearchProvider({ apiKey, fetchFn });
                }
                catch {
                    return fallback;
                }
            }
            case 'brave': {
                const apiKey = config.search.braveApiKey?.trim();
                if (!apiKey)
                    return fallback;
                try {
                    return createBraveSearchProvider({ apiKey, fetchFn });
                }
                catch {
                    return fallback;
                }
            }
            case 'firecrawl': {
                try {
                    return createFirecrawlSearchProvider({
                        apiKey: config.search.firecrawlApiKey?.trim() || undefined,
                        fetchFn,
                    });
                }
                catch {
                    return fallback;
                }
            }
            case 'duckduckgo':
            case 'searxng': // not implemented → use fallback
            default:
                return fallback;
        }
    }
    buildFetchProvider(config, fallback) {
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
    recordSearchFailure(name) {
        const window = this.state.searchFailureWindow;
        window.push(name);
        if (window.length > FALLBACK_LIMIT) {
            window.splice(0, window.length - FALLBACK_LIMIT);
        }
        if (window.length === FALLBACK_LIMIT && window.every((entry) => entry === name)) {
            this.state.invalidSearch.add(name);
        }
    }
    resetSearchWindow(name) {
        this.state.searchFailureWindow = [];
        this.state.invalidSearch.delete(name);
    }
    recordFetchFailure(name) {
        const window = this.state.fetchFailureWindow;
        window.push(name);
        if (window.length > FALLBACK_LIMIT) {
            window.splice(0, window.length - FALLBACK_LIMIT);
        }
        if (window.length === FALLBACK_LIMIT && window.every((entry) => entry === name)) {
            this.state.invalidFetch.add(name);
        }
    }
    resetFetchWindow(name) {
        this.state.fetchFailureWindow = [];
        this.state.invalidFetch.delete(name);
    }
}
function describeSearchError(error) {
    if (error instanceof SearchProviderError) {
        const status = error.status ? ` (${error.status})` : '';
        return `${error.kind}${status}: ${error.message}`;
    }
    return error instanceof Error ? error.message : String(error);
}
function describeFetchError(error) {
    if (error instanceof FetchProviderError) {
        const status = error.status ? ` (${error.status})` : '';
        return `${error.kind}${status}: ${error.message}`;
    }
    return error instanceof Error ? error.message : String(error);
}
function runWithAbortSignal(operation, signal) {
    if (!signal)
        return operation;
    if (signal.aborted)
        return Promise.reject(getAbortReason(signal));
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            signal.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(getAbortReason(signal));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        operation.then((value) => {
            cleanup();
            resolve(value);
        }, (error) => {
            cleanup();
            reject(error);
        });
    });
}
function getAbortReason(signal) {
    if (signal.reason instanceof Error)
        return signal.reason;
    if (signal.reason)
        return signal.reason;
    return new DOMException('operation aborted', 'AbortError');
}
