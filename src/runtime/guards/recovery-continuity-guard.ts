import { guardEvent, type GuardDecision } from './policy.js';

export function evaluateRecoveryContinuityGuard(input: {
  taskId: string;
  recovering: boolean;
  hasSnapshot: boolean;
  hasTraceReference: boolean;
}): GuardDecision {
  if (!input.recovering || input.hasSnapshot || input.hasTraceReference) {
    return { ok: true, mode: 'pass', events: [guardEvent({ guardId: 'recovery-continuity', mode: 'passed', taskId: input.taskId, category: 'recovery_continuity' })] };
  }

  const reason = 'Recovery started without a persisted snapshot or trace reference.';
  return {
    ok: false,
    mode: 'warn',
    reason,
    action: 'Confirm the previous task state before continuing, or restart from a fresh prompt.',
    allowOverride: true,
    events: [guardEvent({
      guardId: 'recovery-continuity',
      mode: 'warned',
      taskId: input.taskId,
      category: 'missing_recovery_runtime',
      reason,
    })],
  };
}
