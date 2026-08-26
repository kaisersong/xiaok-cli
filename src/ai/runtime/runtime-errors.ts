import { isAbortError } from './abort-utils.js';

export interface RuntimeErrorShape {
  code:
    | 'model_failed'
    | 'tool_failed'
    | 'permission_denied'
    | 'runtime_aborted'
    | 'kimi_k3_durable_resume_unsupported';
  message: string;
  retryable: boolean;
}

export function normalizeRuntimeError(error: unknown): RuntimeErrorShape {
  if (isAbortError(error)) {
    const message = error instanceof Error ? error.message : 'aborted';
    return { code: 'runtime_aborted', message, retryable: false };
  }

  const message = error instanceof Error ? error.message : String(error);
  const status = error && typeof error === 'object'
    ? (error as { status?: unknown }).status
    : undefined;
  if (message.includes('KIMI_K3_DURABLE_RESUME_UNSUPPORTED')) {
    return {
      code: 'kimi_k3_durable_resume_unsupported',
      message: 'KIMI_K3_DURABLE_RESUME_UNSUPPORTED',
      retryable: false,
    };
  }
  if (/502|503|timeout|ECONNRESET|Bad gateway/i.test(message)) {
    return { code: 'model_failed', message, retryable: true };
  }
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { code: 'model_failed', message, retryable: false };
  }
  if (/权限|denied|取消/i.test(message)) {
    return { code: 'permission_denied', message, retryable: false };
  }
  return { code: 'tool_failed', message, retryable: false };
}
