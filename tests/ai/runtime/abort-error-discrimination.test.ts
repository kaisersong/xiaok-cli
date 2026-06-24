import { describe, expect, it } from 'vitest';
import { isAbortError } from '../../../src/ai/runtime/abort-utils.js';
import { normalizeRuntimeError } from '../../../src/ai/runtime/runtime-errors.js';

describe('abort error discrimination', () => {
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
});
