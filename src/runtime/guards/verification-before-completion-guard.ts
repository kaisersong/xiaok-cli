import type { TraceBundleV1 } from '../trace/schema.js';
import { guardEvent, type ExecutionScope, type GuardDecision } from './policy.js';

const VERIFY_PATTERNS = [
  /\bnpm\s+(run\s+)?test\b/i,
  /\bnpm\s+run\s+build\b/i,
  /\bvitest\b/i,
  /\bnode\s+--test\b/i,
  /\btsc\b/i,
  /\bcargo\s+test\b/i,
  /\bpytest\b/i,
  /\bpython\s+-m\s+pytest\b/i,
];

export function evaluateVerificationBeforeCompletionGuard(input: {
  scope: ExecutionScope;
  bundle: TraceBundleV1;
}): GuardDecision {
  if (input.scope.kind !== 'code') {
    return { ok: true, mode: 'pass', events: [guardEvent({ guardId: 'verification-before-completion', mode: 'passed', category: 'not_code_scope' })] };
  }

  const hasVerification = input.bundle.toolCalls.some((toolCall) => {
    const haystack = `${toolCall.name}\n${toolCall.inputPreview}\n${toolCall.outputPreview ?? ''}`;
    return toolCall.ok !== false && VERIFY_PATTERNS.some((pattern) => pattern.test(haystack));
  });
  if (hasVerification) {
    return { ok: true, mode: 'pass', events: [guardEvent({ guardId: 'verification-before-completion', mode: 'passed', category: 'verified_completion' })] };
  }

  const reason = 'Code task is being completed without verification evidence.';
  return {
    ok: false,
    mode: input.scope.confidence >= 0.7 ? 'warn' : 'warn',
    reason,
    action: 'Run the relevant test/build command or explicitly override with a reason.',
    allowOverride: true,
    events: [guardEvent({
      guardId: 'verification-before-completion',
      mode: 'warned',
      category: 'missing_verification',
      reason,
    })],
  };
}
