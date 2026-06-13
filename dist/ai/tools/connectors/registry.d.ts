import type { ConnectorsConfig, ProviderRuntime } from './config.js';
import type { SearchHit, SearchProvider, SearchRunInput } from './search/types.js';
import type { FetchProvider, FetchResult, FetchRunInput } from './fetch/types.js';
export interface ProviderInjections {
    fetchFn?: typeof fetch;
}
export interface SearchRunOutcome {
    hits: SearchHit[];
    primary: SearchProvider['name'];
    effective: SearchProvider['name'];
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
/**
 * In-memory provider registry. Construct once and call apply() whenever the
 * source config changes — never reach into provider internals from the tools.
 *
 * Failure counter is in-memory (resets on process restart) by design: the
 * counter exists to protect users from accidental cost / latency blowups
 * inside a single session, not to drive durable diagnostics.
 */
export declare class ConnectorRegistry {
    private readonly injections;
    private state;
    constructor(config: ConnectorsConfig, injections?: ProviderInjections);
    apply(config: ConnectorsConfig): void;
    /** Snapshot used by tools so a single execute call is consistent. */
    getSearchProvider(): SearchProvider;
    getFetchProvider(): FetchProvider;
    getConfig(): ConnectorsConfig;
    listProviderRuntimes(): ProviderRuntime[];
    runSearch(input: SearchRunInput): Promise<SearchRunOutcome>;
    runFetch(input: FetchRunInput): Promise<FetchRunOutcome>;
    private buildState;
    private buildSearchProvider;
    private buildFetchProvider;
    private recordSearchFailure;
    private resetSearchWindow;
    private recordFetchFailure;
    private resetFetchWindow;
}
