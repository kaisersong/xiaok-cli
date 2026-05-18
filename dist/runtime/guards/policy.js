export function guardEvent(input) {
    const refs = {};
    if (input.taskId)
        refs.taskId = input.taskId;
    if (input.artifactId)
        refs.artifactId = input.artifactId;
    return {
        id: `guard:${input.guardId}:${input.mode}:${safeId(input.target ?? input.taskId ?? input.artifactId ?? 'target')}`,
        ts: new Date().toISOString(),
        source: 'guard',
        type: `guard.${input.mode}`,
        severity: input.mode === 'blocked' ? 'error' : input.mode === 'warned' ? 'warn' : 'info',
        refs,
        data: {
            guardId: input.guardId,
            category: input.category,
            reason: input.reason,
            action: input.action,
            target: input.target,
            override: input.override,
        },
    };
}
function safeId(value) {
    return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}
