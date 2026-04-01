export interface RuntimeErrorShape {
  code: 'model_failed' | 'tool_failed' | 'permission_denied' | 'runtime_aborted';
  message: string;
  retryable: boolean;
}

export function normalizeRuntimeError(error: unknown): RuntimeErrorShape {
  const message = error instanceof Error ? error.message : String(error);
  if (/502|503|timeout|ECONNRESET|Bad gateway/i.test(message)) {
    return { code: 'model_failed', message, retryable: true };
  }
  if (/权限|denied|取消/i.test(message)) {
    return { code: 'permission_denied', message, retryable: false };
  }
  if (/aborted/i.test(message)) {
    return { code: 'runtime_aborted', message, retryable: false };
  }
  return { code: 'tool_failed', message, retryable: false };
}
