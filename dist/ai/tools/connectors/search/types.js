// Shared interface for all web_search providers.
// Providers are pure transports: they take a query, return normalized SearchHit[].
// Provider construction validates config; selection / fallback / wiring lives in the registry.
/**
 * Thrown by a provider when the upstream call fails in a way the registry can
 * surface verbatim to the user (HTTP error, network error, malformed body).
 * Carrying both kind and message lets the registry attach a short, redacted
 * tag to the tool output instead of dumping HTML or a raw stack.
 */
export class SearchProviderError extends Error {
    kind;
    status;
    constructor(message, opts) {
        super(message);
        this.name = 'SearchProviderError';
        this.kind = opts.kind;
        this.status = opts.status;
    }
}
