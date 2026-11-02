import { associateModelFailure, classifyModelFailure, readModelFailureField as data } from './model-failure.js';

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

export interface KimiProviderRequestDiagnostic {
  code: typeof KIMI_REQUEST_FAILED;
  retryable: boolean;
  status?: number;
  failureKind: string;
  transportCode?: string;
  providerCode?: string;
}

function httpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}
function knownCode(value: unknown, allowed: Set<string>): string | undefined {
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}
function permanentStatus(status?: number): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}
function statusKind(status: number): string {
  return status === 401 ? 'authentication' : status === 403 ? 'permission'
    : status === 408 ? 'timeout' : status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'request';
}

/** Extract only fixed-vocabulary diagnostics. Never retain the original error or its cause/body. */
export function createKimiProviderRequestError(raw: unknown, retryable: boolean, providerResponse = false): Error & KimiProviderRequestDiagnostic {
  const failure = classifyModelFailure(raw, 'kimi');
  if (providerResponse && failure.category === 'internal') { failure.source = 'provider'; failure.category = 'unknown'; }
  const kind = failure.status !== undefined ? statusKind(failure.status)
    : failure.category === 'network' ? 'transport' : failure.category;
  const diagnostic: KimiProviderRequestDiagnostic = {
    code: KIMI_REQUEST_FAILED,
    retryable: ['internal', 'unknown'].includes(failure.category) ? retryable : failure.retryable,
    failureKind: FAILURE_KINDS.has(kind) ? kind : 'unknown',
    status: failure.status,
    transportCode: knownCode(failure.transportCode, TRANSPORT_CODES),
    providerCode: knownCode(failure.providerCode, PROVIDER_CODES),
  };
  if (failure.category === 'aborted') diagnostic.failureKind = 'aborted';
  const error = Object.assign(new Error(KIMI_REQUEST_FAILED), {
    name: diagnostic.failureKind === 'aborted' ? 'AbortError' : 'KimiK3ProviderRequestError', ...diagnostic,
  });
  associateModelFailure(error, { ...failure, retryable: diagnostic.retryable });
  return error;
}

/** Revalidate fields at the diagnostic sink; never spread an arbitrary exception into logs/UI. */
export function getKimiProviderRequestDiagnostic(error: unknown): KimiProviderRequestDiagnostic | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if (data(error, 'code') !== KIMI_REQUEST_FAILED) return undefined;
  const status = httpStatus(data(error, 'status'));
  const kind = knownCode(data(error, 'failureKind'), FAILURE_KINDS) ?? 'unknown';
  const providerCode = knownCode(data(error, 'providerCode'), PROVIDER_CODES);
  return {
    code: KIMI_REQUEST_FAILED,
    retryable: data(error, 'retryable') === true && !permanentStatus(status) && !PERMANENT_PROVIDER_CODES.has(providerCode ?? '') && kind !== 'aborted',
    status,
    failureKind: kind,
    transportCode: knownCode(data(error, 'transportCode'), TRANSPORT_CODES),
    providerCode,
  };
}

export function formatKimiProviderRequestError(diagnostic: KimiProviderRequestDiagnostic): string {
  const fields = [`category=${diagnostic.failureKind}`];
  if (diagnostic.status !== undefined) fields.push(`http_status=${diagnostic.status}`);
  if (diagnostic.transportCode) fields.push(`transport_code=${diagnostic.transportCode}`);
  if (diagnostic.providerCode) fields.push(`provider_code=${diagnostic.providerCode}`);
  return `${KIMI_REQUEST_FAILED} [${fields.join(', ')}]`;
}
