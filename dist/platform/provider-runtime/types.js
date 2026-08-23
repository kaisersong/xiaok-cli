/**
 * Provider runtime core types (design v58 §3.1–§3.4).
 *
 * Pure logic only: this module must not import Electron or Desktop runtime
 * types. Desktop main owns the single instance; the CLI does not use it yet.
 */
export function componentInstanceKeyOf(componentId, generationId) {
    return Object.freeze({ componentId, generationId });
}
export function sameComponentInstance(a, b) {
    return a.componentId === b.componentId && a.generationId === b.generationId;
}
export class ProviderUnavailableError extends Error {
    code = 'provider_unavailable';
    constructor(message = 'provider_unavailable') {
        super(message);
        this.name = 'ProviderUnavailableError';
    }
}
export class ProviderUnavailableRetryError extends Error {
    code = 'provider_unavailable_retry';
    constructor(message = 'provider_unavailable_retry') {
        super(message);
        this.name = 'ProviderUnavailableRetryError';
    }
}
/** Canonical caller cancellation, rebuilt by gateways from a frozen abortSource. */
export function canonicalAbortError(reason = 'The operation was aborted') {
    if (typeof DOMException === 'function') {
        return new DOMException(reason, 'AbortError');
    }
    const error = new Error(reason);
    error.name = 'AbortError';
    return error;
}
export function isAbortErrorLike(error) {
    return error instanceof Error && error.name === 'AbortError';
}
