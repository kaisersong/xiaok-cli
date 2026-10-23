const STREAM_ERROR_CODE = 'OPENAI_PROVIDER_STREAM_ERROR';
const TYPES = new Set([
    'invalid_api_key', 'server_error', 'rate_limit_error', 'rate_limit_exceeded', 'authentication_error',
    'permission_denied', 'invalid_request_error', 'insufficient_quota',
    'model_not_found', 'context_length_exceeded',
]);
const PERMANENT = new Set([
    'invalid_api_key', 'authentication_error', 'permission_denied', 'invalid_request_error',
    'insufficient_quota', 'model_not_found', 'context_length_exceeded',
]);
const DETAILS = new Set(['NoRoom', 'CudaFailed']);
function known(value, vocabulary) {
    return typeof value === 'string' && vocabulary.has(value) ? value : undefined;
}
function message(diagnostic) {
    return `${STREAM_ERROR_CODE} [type=${diagnostic.providerType}${diagnostic.detail ? `, detail=${diagnostic.detail}` : ''}]`;
}
/** Only called for the exact status-less SDK APIError at the model boundary. */
export function createOpenAIStreamError(raw) {
    const e = raw;
    const type = known(e.type, TYPES);
    const code = known(e.code, TYPES);
    // Quota/auth/request errors win over a generic server_error envelope.
    const providerType = code && PERMANENT.has(code) ? code : type ?? code ?? 'unknown';
    const detail = known(e.message, DETAILS);
    const retryable = e.retryable !== false && !PERMANENT.has(providerType) && detail !== 'CudaFailed'
        && ['server_error', 'rate_limit_error', 'rate_limit_exceeded'].includes(providerType);
    const diagnostic = { providerType, detail, retryable };
    // Do not attach the SDK error: it retains response headers/body and raw text.
    return Object.assign(new Error(message(diagnostic)), {
        name: 'OpenAIProviderStreamError', code: STREAM_ERROR_CODE, ...diagnostic,
    });
}
/** Revalidate the owned shape at the UI/runtime sink; never echo arbitrary text. */
export function getOpenAIStreamFailure(error) {
    if (!error || typeof error !== 'object')
        return undefined;
    const e = error;
    if (e.code !== STREAM_ERROR_CODE)
        return undefined;
    const providerType = known(e.providerType, TYPES) ?? 'unknown';
    const detail = known(e.detail, DETAILS);
    const retryable = e.retryable === true && !PERMANENT.has(providerType) && detail !== 'CudaFailed'
        && ['server_error', 'rate_limit_error', 'rate_limit_exceeded'].includes(providerType);
    return { message: message({ providerType, detail, retryable }), retryable };
}
