import { isAbortError } from './abort-utils.js';
const KIMI_REQUEST_FAILED = 'KIMI_K3_PROVIDER_REQUEST_FAILED';
const TRANSPORT_CODES = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH',
    'EAI_AGAIN', 'ERR_STREAM_PREMATURE_CLOSE', 'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);
const PROVIDER_CODES = new Set([
    'invalid_api_key', 'authentication_error', 'permission_denied', 'invalid_request_error',
    'rate_limit_exceeded', 'insufficient_quota', 'model_not_found', 'server_error',
]);
const FAILURE_KINDS = new Set([
    'authentication', 'permission', 'request', 'rate_limit', 'server',
    'timeout', 'transport', 'aborted', 'unknown',
]);
const PERMANENT_PROVIDER_CODES = new Set([
    'invalid_api_key', 'authentication_error', 'permission_denied', 'invalid_request_error',
    'insufficient_quota', 'model_not_found',
]);
function httpStatus(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}
function knownCode(value, allowed) {
    return typeof value === 'string' && allowed.has(value) ? value : undefined;
}
function permanentStatus(status) {
    return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}
function statusKind(status) {
    return status === 401 ? 'authentication' : status === 403 ? 'permission'
        : status === 408 ? 'timeout' : status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'request';
}
/** Extract only fixed-vocabulary diagnostics. Never retain the original error or its cause/body. */
export function createKimiProviderRequestError(raw, retryable) {
    const diagnostic = { code: KIMI_REQUEST_FAILED, retryable, failureKind: 'unknown' };
    const seen = new Set();
    let current = raw;
    let aborted = false;
    while (current && typeof current === 'object' && !seen.has(current) && seen.size < 16) {
        seen.add(current);
        const record = current;
        const status = httpStatus(record.status);
        if (status !== undefined && (diagnostic.status === undefined || permanentStatus(status))) {
            diagnostic.status = status;
            diagnostic.failureKind = statusKind(status);
        }
        diagnostic.transportCode ??= knownCode(record.code, TRANSPORT_CODES);
        const body = record.error && typeof record.error === 'object' ? record.error : undefined;
        diagnostic.providerCode ??= knownCode(record.code, PROVIDER_CODES) ?? knownCode(body?.code, PROVIDER_CODES);
        if (isAbortError(current))
            aborted = true;
        else if (diagnostic.failureKind === 'unknown') {
            if (record.name === 'TimeoutError' || record.name === 'APIConnectionTimeoutError')
                diagnostic.failureKind = 'timeout';
            else if (record.name === 'APIConnectionError')
                diagnostic.failureKind = 'transport';
        }
        current = record.cause;
    }
    if (aborted)
        diagnostic.failureKind = 'aborted';
    if (diagnostic.failureKind === 'unknown' && diagnostic.transportCode)
        diagnostic.failureKind = 'transport';
    if (permanentStatus(diagnostic.status) || PERMANENT_PROVIDER_CODES.has(diagnostic.providerCode ?? '') || diagnostic.failureKind === 'aborted') {
        diagnostic.retryable = false;
    }
    else if (diagnostic.status === 408 || diagnostic.status === 429 || (diagnostic.status ?? 0) >= 500
        || diagnostic.transportCode || diagnostic.failureKind === 'timeout' || diagnostic.failureKind === 'transport') {
        diagnostic.retryable = true;
    }
    return Object.assign(new Error(KIMI_REQUEST_FAILED), {
        name: diagnostic.failureKind === 'aborted' ? 'AbortError' : 'KimiK3ProviderRequestError', ...diagnostic,
    });
}
/** Revalidate fields at the diagnostic sink; never spread an arbitrary exception into logs/UI. */
export function getKimiProviderRequestDiagnostic(error) {
    if (!error || typeof error !== 'object')
        return undefined;
    const e = error;
    if (e.code !== KIMI_REQUEST_FAILED)
        return undefined;
    const status = httpStatus(e.status);
    return {
        code: KIMI_REQUEST_FAILED,
        retryable: e.retryable === true && !permanentStatus(status) && !PERMANENT_PROVIDER_CODES.has(String(e.providerCode)) && e.failureKind !== 'aborted',
        status,
        failureKind: typeof e.failureKind === 'string' && FAILURE_KINDS.has(e.failureKind) ? e.failureKind : 'unknown',
        transportCode: knownCode(e.transportCode, TRANSPORT_CODES),
        providerCode: knownCode(e.providerCode, PROVIDER_CODES),
    };
}
export function formatKimiProviderRequestError(diagnostic) {
    const fields = [`category=${diagnostic.failureKind}`];
    if (diagnostic.status !== undefined)
        fields.push(`http_status=${diagnostic.status}`);
    if (diagnostic.transportCode)
        fields.push(`transport_code=${diagnostic.transportCode}`);
    if (diagnostic.providerCode)
        fields.push(`provider_code=${diagnostic.providerCode}`);
    return `${KIMI_REQUEST_FAILED} [${fields.join(', ')}]`;
}
