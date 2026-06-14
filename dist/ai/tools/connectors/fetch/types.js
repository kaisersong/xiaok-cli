// Shared interface for all web_fetch providers.
// Providers return text that is already model-friendly (markdown or plain).
export class FetchProviderError extends Error {
    kind;
    status;
    constructor(message, opts) {
        super(message);
        this.name = 'FetchProviderError';
        this.kind = opts.kind;
        this.status = opts.status;
    }
}
