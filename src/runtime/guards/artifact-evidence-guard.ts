import { guardEvent, type GuardDecision } from './policy.js';
import {
  validateCompletionEvidence,
  type CompletionEvidenceRecord,
  type CompletionExpectation,
} from './completion-evidence.js';

const EMPTY_ARTIFACT_REASON = 'Task is being completed without artifact evidence.';
const EMPTY_ARTIFACT_ACTION = 'Attach or generate at least one artifact before marking the task complete, or provide a human override.';

export function evaluateArtifactEvidenceGuard(input: {
  taskId: string;
  status: string;
  artifacts?: unknown[];
  expectation?: CompletionExpectation;
  evidence?: CompletionEvidenceRecord[];
}): GuardDecision {
  const terminal = input.status === 'success' || input.status === 'done' || input.status === 'submitted' || input.status === 'completed';
  if (!terminal) {
    return pass(input.taskId);
  }

  if (input.expectation !== undefined || input.evidence !== undefined) {
    const validation = validateCompletionEvidence({
      ownerKind: 'task',
      ownerId: input.taskId,
      targetStatus: input.status,
      expectation: input.expectation,
      evidence: input.evidence,
    });
    if (validation.ok) {
      return pass(input.taskId);
    }
    return block(input.taskId, reasonForValidationFailure(input.expectation, validation));
  }

  if ((input.artifacts?.length ?? 0) > 0) {
    return pass(input.taskId);
  }

  return block(input.taskId, EMPTY_ARTIFACT_REASON);
}

function pass(taskId: string): GuardDecision {
  return {
    ok: true,
    mode: 'pass',
    events: [guardEvent({ guardId: 'artifact-evidence', mode: 'passed', taskId, category: 'artifact_evidence' })],
  };
}

function block(taskId: string, reason: string): GuardDecision {
  return {
    ok: false,
    mode: 'block',
    reason,
    action: EMPTY_ARTIFACT_ACTION,
    allowOverride: true,
    events: [guardEvent({
      guardId: 'artifact-evidence',
      mode: 'blocked',
      taskId,
      category: 'empty_artifact',
      reason,
    })],
  };
}

function reasonForValidationFailure(
  expectation: CompletionExpectation | undefined,
  validation: ReturnType<typeof validateCompletionEvidence>,
): string {
  if (validation.failureKind === 'evidence_missing' && expectation?.expectedKinds.includes('file_artifact')) {
    return EMPTY_ARTIFACT_REASON;
  }
  return validation.message ?? EMPTY_ARTIFACT_REASON;
}
