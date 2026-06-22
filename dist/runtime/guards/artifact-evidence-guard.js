import { guardEvent } from './policy.js';
import { validateCompletionEvidence, } from './completion-evidence.js';
const EMPTY_ARTIFACT_REASON = 'Task is being completed without artifact evidence.';
const EMPTY_ARTIFACT_ACTION = 'Attach or generate at least one artifact before marking the task complete, or provide a human override.';
export function evaluateArtifactEvidenceGuard(input) {
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
        // A text answer is always sufficient evidence — even when the prompt classifier
        // guessed file_artifact / project_update / log_diagnostic etc. Users iterate via
        // chat; missing artifacts are fixed by follow-up turns, not by blocking the
        // entire task as failed.
        if (input.expectation
            && !input.expectation.expectedKinds.includes('answer')
            && hasAnyAnswerEvidence(input.taskId, input.evidence)) {
            return pass(input.taskId);
        }
        return block(input.taskId, reasonForValidationFailure(input.expectation, validation));
    }
    return pass(input.taskId);
}
function pass(taskId) {
    return {
        ok: true,
        mode: 'pass',
        events: [guardEvent({ guardId: 'artifact-evidence', mode: 'passed', taskId, category: 'artifact_evidence' })],
    };
}
function block(taskId, reason) {
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
function reasonForValidationFailure(expectation, validation) {
    if (expectation?.expectedKinds.includes('file_artifact')
        && (validation.failureKind === 'evidence_missing' || validation.failureKind === 'evidence_kind_mismatch')) {
        return EMPTY_ARTIFACT_REASON;
    }
    return validation.message ?? EMPTY_ARTIFACT_REASON;
}
function hasAnyAnswerEvidence(taskId, evidence) {
    if (!evidence || evidence.length === 0)
        return false;
    return evidence.some(record => record.ownerKind === 'task'
        && record.ownerId === taskId
        && record.kind === 'answer'
        && typeof record.summary === 'string'
        && record.summary.trim().length > 0);
}
