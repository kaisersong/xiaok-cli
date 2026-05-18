import { redactString } from './redactor.js';
export function normalizeRuntimeEvent(event) {
    const now = new Date().toISOString();
    if (event.type === 'pre_tool_use') {
        return [{
                id: `runtime:${event.sessionId}:${event.turnId}:${event.toolUseId}:pre_tool_use`,
                ts: now,
                source: 'tool',
                type: 'tool.started',
                refs: { turnId: event.turnId, toolCallId: event.toolUseId },
                data: { toolName: event.toolName },
            }];
    }
    if (event.type === 'post_tool_use') {
        return [{
                id: `runtime:${event.sessionId}:${event.turnId}:${event.toolUseId}:post_tool_use`,
                ts: now,
                source: 'tool',
                type: 'tool.finished',
                refs: { turnId: event.turnId, toolCallId: event.toolUseId },
                data: { toolName: event.toolName },
            }];
    }
    if (event.type === 'post_tool_use_failure') {
        const error = redactString(event.error, `events.${event.toolUseId}.error`).value;
        return [{
                id: `runtime:${event.sessionId}:${event.turnId}:${event.toolUseId}:post_tool_use_failure`,
                ts: now,
                source: 'tool',
                type: 'tool.failed',
                severity: 'error',
                refs: { turnId: event.turnId, toolCallId: event.toolUseId },
                data: { toolName: event.toolName, error },
            }];
    }
    return [{
            id: `runtime:${'sessionId' in event ? event.sessionId : 'unknown'}:${event.type}`,
            ts: now,
            source: 'cli',
            type: `runtime.${event.type}`,
        }];
}
export function normalizeDesktopRuntimeEvent(event) {
    if (!isRecord(event) || typeof event.type !== 'string')
        return [];
    const sessionId = typeof event.sessionId === 'string' ? event.sessionId : 'unknown';
    const now = new Date().toISOString();
    if (event.type === 'artifact_written' && typeof event.artifactId === 'string') {
        return [{
                id: `desktop:${sessionId}:${event.artifactId}:artifact_written`,
                ts: now,
                source: 'desktop',
                type: 'artifact.written',
                refs: {
                    artifactId: event.artifactId,
                    toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : undefined,
                },
                data: {
                    kind: typeof event.kind === 'string' ? event.kind : undefined,
                    path: typeof event.path === 'string' ? event.path : undefined,
                },
            }];
    }
    if (event.type === 'file_changed' && typeof event.filePath === 'string') {
        return [{
                id: `desktop:${sessionId}:${event.filePath}:${event.event ?? 'change'}`,
                ts: now,
                source: 'desktop',
                type: 'file.changed',
                data: {
                    filePath: event.filePath,
                    event: typeof event.event === 'string' ? event.event : 'change',
                },
            }];
    }
    return [];
}
export function normalizeKSwarmProjectDetail(detail) {
    const tasks = (detail.tasks ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        assignedAgent: task.assignedAgent,
        dependencies: task.dependencies,
        phase: task.phase,
        failureClass: task.failureClass,
        failureCount: task.qualityFailureCount ?? task.failureCount,
        blockedReason: task.blockedReason,
        artifacts: task.artifacts?.map((artifact) => artifact.path ?? artifact.url ?? artifact.name).filter(Boolean),
    }));
    const agents = (detail.agents ?? []).map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        currentTask: agent.currentTask,
    }));
    const events = [];
    const ts = new Date().toISOString();
    if (detail.projectHealth) {
        events.push({
            id: `kswarm:${detail.project.id}:project_health`,
            ts,
            source: 'kswarm',
            type: 'kswarm.project_health',
            message: detail.projectHealth.message,
            refs: detail.projectHealth.primaryBlockedTaskId ? { taskId: detail.projectHealth.primaryBlockedTaskId } : undefined,
            data: { status: detail.projectHealth.status },
        });
    }
    for (const blocked of detail.dispatchPlan?.blocked ?? []) {
        events.push({
            id: `kswarm:${detail.project.id}:dispatch_blocked:${blocked.taskId}`,
            ts,
            source: 'kswarm',
            type: 'kswarm.dispatch_blocked',
            refs: { taskId: blocked.taskId },
            data: { reason: blocked.reason, blockedByTaskId: blocked.blockedByTaskId },
        });
    }
    return {
        tasks,
        agents,
        events,
        summary: {
            projectId: detail.project.id,
            projectName: detail.project.name,
            projectStatus: detail.project.status,
            projectHealth: detail.projectHealth?.status,
            taskCount: tasks.length,
            agentCount: agents.length,
        },
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
