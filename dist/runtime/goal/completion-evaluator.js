export class GoalCompletionEvaluator {
    evaluate(goal, evidence) {
        const current = evidence.filter(item => item.goalId === goal.goalId
            && item.epoch === goal.epoch
            && item.record.ownerKind === 'goal'
            && item.record.ownerId === goal.goalId);
        const missingKinds = goal.expectedEvidenceKinds.filter(kind => !current.some(item => item.record.kind === kind && isStrictlyValid(item)));
        return missingKinds.length === 0
            ? { ok: true, missingKinds: [] }
            : {
                ok: false,
                missingKinds,
                message: `Goal completion evidence is missing or invalid: ${missingKinds.join(', ')}`,
            };
    }
}
function isStrictlyValid(envelope) {
    const record = envelope.record;
    if (!record.summary.trim())
        return false;
    switch (record.kind) {
        case 'answer':
            return hasText(record.metadata?.responseId) || hasText(record.metadata?.responseSnapshotHash);
        case 'file_artifact':
            return hasText(record.uri) || isStringArray(record.metadata?.paths);
        case 'command_action': {
            const commands = record.metadata?.commands;
            return Array.isArray(commands) && commands.length > 0 && commands.every(command => typeof command === 'object'
                && command !== null
                && command.exitCode === 0);
        }
        case 'project_update':
            return hasText(record.metadata?.projectId);
        default:
            return false;
    }
}
function hasText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function isStringArray(value) {
    return Array.isArray(value) && value.length > 0 && value.every(hasText);
}
