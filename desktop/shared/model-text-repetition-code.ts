/**
 * Renderer-safe repetition diagnostics (pure, no host/runtime imports).
 * Mirrors src/ai/runtime/model-text-repetition.ts; parity is enforced by
 * desktop/tests/renderer/model-text-repetition-code-parity.test.ts.
 */
export const MODEL_TEXT_REPETITION_CODE = 'MODEL_TEXT_REPETITION_DETECTED';

/** Matches diagnostic code prefix chains, never incidental mentions. */
export function isModelTextRepetitionMessage(text: string): boolean {
  return /^(?:[A-Za-z_][A-Za-z0-9_]*:\s*)*MODEL_TEXT_REPETITION_DETECTED(?![A-Za-z0-9_])/.test(text);
}

/** Prefer structured diagnostics throughout the cause chain before text fallback. */
export function isModelTextRepetitionError(error: unknown): boolean {
  const seen = new Set<object>();
  const messages: string[] = [];
  let current = error;
  while (current != null) {
    if (typeof current === 'string') { messages.push(current); break; }
    if (typeof current !== 'object' || seen.has(current)) break;
    seen.add(current);
    const diagnostic = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (diagnostic.code === MODEL_TEXT_REPETITION_CODE) return true;
    if (typeof diagnostic.message === 'string') messages.push(diagnostic.message);
    current = diagnostic.cause;
  }
  return messages.some(isModelTextRepetitionMessage);
}
