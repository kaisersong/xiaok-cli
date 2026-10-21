import { type RequestOptions } from 'node:https';
export interface SingleRequestHttpsOptions {
    destination: string;
    expectedBody: string;
    method?: 'POST' | 'GET';
    timeoutMs: number;
    maxResponseBytes: number;
    signal?: AbortSignal;
    /** Internal TLS trust injection for local transport tests. Never populated by a product policy. */
    certificateAuthority?: RequestOptions['ca'];
    /** Host lifecycle registration; SDK abort can finish before it awaits body cancellation. */
    trackPhysicalDrain?: (drain: Promise<void>) => void;
}
/**
 * Low-level transport, not an authorization issuer. Product callers must first bind a
 * durable budget and disclosure capability. One instance permits one HTTP request.
 * Core HTTPS has no HTTP redirect/retry machinery; using global fetch here is unsafe.
 */
export declare function createSingleRequestHttpsFetch(options: SingleRequestHttpsOptions): typeof globalThis.fetch;
