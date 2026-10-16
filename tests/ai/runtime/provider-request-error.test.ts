import { describe, expect, it } from 'vitest';
import { createKimiProviderRequestError, getKimiProviderRequestDiagnostic, formatKimiProviderRequestError } from '../../../src/ai/runtime/provider-request-error.js';
import { normalizeRuntimeError } from '../../../src/ai/runtime/runtime-errors.js';

describe('safe Kimi request diagnostics', () => {
  it.each([408, 429, 500, 504])('keeps HTTP %s recoverable', status => {
    const error = createKimiProviderRequestError(Object.assign(new Error('private'), { status }), false);
    expect(error).toMatchObject({ status, retryable: true });
    expect(normalizeRuntimeError(error)).toMatchObject({ code: 'model_failed', retryable: true });
  });
  it.each([400, 401, 403])('preserves permanent HTTP %s behind a network wrapper', status => {
    const error = createKimiProviderRequestError(new Error('network wrapper', {
      cause: Object.assign(new Error('private'), { status }),
    }), true);
    expect(error).toMatchObject({ status, retryable: false });
  });
  it('does not recover an exhausted quota even with HTTP429', () => {
    const error = createKimiProviderRequestError(Object.assign(new Error('private'), {
      status: 429, error: { code: 'insufficient_quota' },
    }), true);
    expect(error.retryable).toBe(false);
    expect(normalizeRuntimeError(error)).toMatchObject({ code: 'model_failed', retryable: false });
  });
  it.each(['APIConnectionError', 'APIConnectionTimeoutError'])('recognizes SDK %s without copying its message', name => {
    const error = createKimiProviderRequestError(Object.assign(new Error('private'), { name }), false);
    expect(error.retryable).toBe(true);
  });
  it('preserves abort precedence and terminates cyclic causes', () => {
    const aborted = new DOMException('private', 'AbortError');
    const cycle = Object.assign(new Error('private'), { code: 'ECONNRESET', cause: aborted });
    Object.assign(aborted, { cause: cycle });
    const error = createKimiProviderRequestError(cycle, true);
    expect(normalizeRuntimeError(error)).toMatchObject({ code: 'runtime_aborted', retryable: false });
    expect(error.cause).toBeUndefined();
  });
  it('drops arbitrary fields and revalidates metadata at the sink', () => {
    const error = createKimiProviderRequestError(Object.assign(new Error('PRIVATE_CANARY'), {
      status: 401.5, code: 'PRIVATE_CANARY', error: { code: 'PRIVATE_CANARY' },
    }), false);
    Object.assign(error, { status: 'PRIVATE_CANARY', failureKind: 'PRIVATE_CANARY', transportCode: 'PRIVATE_CANARY', providerCode: 'PRIVATE_CANARY' });
    const diagnostic = getKimiProviderRequestDiagnostic(error)!;
    expect(diagnostic).toMatchObject({ failureKind: 'unknown', retryable: false });
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE_CANARY');
    expect(formatKimiProviderRequestError(diagnostic)).not.toContain('PRIVATE_CANARY');
  });
});
