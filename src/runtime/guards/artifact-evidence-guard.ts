import { guardEvent, type GuardDecision } from './policy.js';

export function evaluateArtifactEvidenceGuard(input: {
  taskId: string;
  status: string;
  artifacts?: unknown[];
}): GuardDecision {
  const terminal = input.status === 'done' || input.status === 'submitted' || input.status === 'completed';
  if (!terminal || (input.artifacts?.length ?? 0) > 0) {
    return {
      ok: true,
      mode: 'pass',
      events: [guardEvent({ guardId: 'artifact-evidence', mode: 'passed', taskId: input.taskId, category: 'artifact_evidence' })],
    };
  }
  const reason = 'Task is being completed without artifact evidence.';
  return {
    ok: false,
    mode: 'block',
    reason,
    action: 'Attach or generate at least one artifact before marking the task complete, or provide a human override.',
    allowOverride: true,
    events: [guardEvent({
      guardId: 'artifact-evidence',
      mode: 'blocked',
      taskId: input.taskId,
      category: 'empty_artifact',
      reason,
    })],
  };
}
