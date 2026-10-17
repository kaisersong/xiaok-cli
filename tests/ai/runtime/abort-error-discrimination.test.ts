import { describe, expect, it } from 'vitest';
import { isAbortError } from '../../../src/ai/runtime/abort-utils.js';
import { normalizeRuntimeError } from '../../../src/ai/runtime/runtime-errors.js';

describe('abort error discrimination', () => {
  it.each([true, false])('classifies a Kimi request as a model failure (retryable=%s)', retryable => {
    const error = Object.assign(new Error('KIMI_K3_PROVIDER_REQUEST_FAILED'), {
      code: 'KIMI_K3_PROVIDER_REQUEST_FAILED', retryable,
    });
    expect(normalizeRuntimeError(error)).toMatchObject({ code: 'model_failed', retryable });
  });
  it('does not let a provider retryable marker override permanent HTTP or abort', () => {
    expect(normalizeRuntimeError(Object.assign(new Error('KIMI_K3_PROVIDER_REQUEST_FAILED'), {
      code: 'KIMI_K3_PROVIDER_REQUEST_FAILED', status: 401, retryable: true,
    }))).toMatchObject({ code: 'model_failed', retryable: false });
    expect(normalizeRuntimeError(Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError', code: 'KIMI_K3_PROVIDER_REQUEST_FAILED', retryable: true,
    }))).toMatchObject({ code: 'runtime_aborted', retryable: false });
  });
  it('recognizes DOMException and Error AbortError by name', () => {
    expect(isAbortError(new DOMException('agent aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(Object.assign(new Error('agent aborted'), { name: 'AbortError' }))).toBe(true);
  });

  it('does not classify ordinary aborted text as runtime abort', () => {
    const error = new Error('Connection aborted by peer');

    expect(isAbortError(error)).toBe(false);
    expect(normalizeRuntimeError(error)).toMatchObject({
      code: 'tool_failed',
      retryable: false,
    });
  });

  it('recognizes OpenAI APIUserAbortError as a user abort', () => {
    class APIUserAbortError extends Error {}
    const sdkError = new APIUserAbortError('Request was aborted.');

    expect(isAbortError(sdkError)).toBe(true);
  });

  it('recognizes a plain Error with the SDK abort message as a user abort', () => {
    expect(isAbortError(new Error('Request was aborted.'))).toBe(true);
    expect(isAbortError(new Error('request was aborted'))).toBe(true);
  });

  it('keeps timeout and 502 failures in model failure classification', () => {
    expect(isAbortError(Object.assign(new Error('request timed out'), { name: 'TimeoutError' }))).toBe(false);
    expect(normalizeRuntimeError(new Error('request timeout'))).toMatchObject({
      code: 'model_failed',
      retryable: true,
    });
    expect(normalizeRuntimeError(new Error('502 Bad gateway'))).toMatchObject({
      code: 'model_failed',
      retryable: true,
    });
  });

  it('classifies provider transport read failures as retryable model failures', () => {
    expect(normalizeRuntimeError(new Error('read ETIMEDOUT'))).toEqual({
      code: 'model_failed',
      message: 'read ETIMEDOUT',
      retryable: true,
    });
    expect(normalizeRuntimeError(Object.assign(new Error('read failed'), {
      code: 'ETIMEDOUT',
    }))).toMatchObject({
      code: 'model_failed',
      retryable: true,
    });
    expect(normalizeRuntimeError(Object.assign(new Error('Premature close'), {
      code: 'ERR_STREAM_PREMATURE_CLOSE',
    }))).toMatchObject({
      code: 'model_failed',
      retryable: true,
    });
  });

  it('classifies provider HTTP 4xx errors as non-retryable model failures', () => {
    const error = Object.assign(new Error(
      "400 Messages with role 'tool' must be a response to a preceding message with 'tool_calls'",
    ), { status: 400 });

    expect(normalizeRuntimeError(error)).toMatchObject({
      code: 'model_failed',
      retryable: false,
    });
  });

  it('classifies K3 durable resume as a terminal non-retryable capability result', () => {
    expect(normalizeRuntimeError(
      new Error('KIMI_K3_DURABLE_RESUME_UNSUPPORTED'),
    )).toEqual({
      code: 'kimi_k3_durable_resume_unsupported',
      message: 'KIMI_K3_DURABLE_RESUME_UNSUPPORTED',
      retryable: false,
    });
  });
});
