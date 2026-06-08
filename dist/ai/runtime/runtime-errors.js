import { isAbortError } from './abort-utils.js';
export function normalizeRuntimeError(error) {
    if (isAbortError(error)) {
        const message = error instanceof Error ? error.message : 'aborted';
        return { code: 'runtime_aborted', message, retryable: false };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/502|503|timeout|ECONNRESET|Bad gateway/i.test(message)) {
        return { code: 'model_failed', message, retryable: true };
    }
    if (/权限|denied|取消/i.test(message)) {
        return { code: 'permission_denied', message, retryable: false };
    }
    return { code: 'tool_failed', message, retryable: false };
}
