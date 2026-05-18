import { diagnoseTraceBundle } from './diagnoser.js';
export function diagnoseProjectSnapshot(input) {
    const tasks = (input.tasks ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        assignedAgent: task.assignedAgent,
        dependencies: task.dependencies,
        blockedReason: task.blockedReason,
        failureCount: task.qualityFailureCount ?? task.failureCount,
        artifacts: task.artifacts,
    }));
    const bundle = {
        schemaVersion: 1,
        bundleId: `project_${input.project.id}_diagnosis`,
        createdAt: new Date().toISOString(),
        source: { app: 'kswarm' },
        scope: { kind: 'project', projectId: input.project.id },
        environment: {},
        turns: [],
        events: [],
        toolCalls: [],
        approvals: [],
        tasks,
        agents: input.agents ?? [],
        artifacts: [],
        memoryRefs: [],
        skillEvidence: [],
        recovery: [],
        crashes: [],
        redactions: [],
        attachments: [],
        summary: {
            projectStatus: input.project.status,
            projectHealth: input.projectHealth?.status,
        },
    };
    const report = diagnoseTraceBundle(bundle);
    const dispatchable = input.dispatchPlan?.dispatchable ?? [];
    const hasBlocked = report.findings.some((finding) => finding.category === 'blocked_task');
    if (hasBlocked && dispatchable.length > 0) {
        report.findings.push(dispatchStalledFinding(dispatchable[0].taskId));
        report.recommendedActions.push({ id: 'split_or_reassign_review', label: '拆分或重派评审任务', recommended: true });
    }
    return report;
}
function dispatchStalledFinding(taskId) {
    return {
        id: `finding:dispatch_stalled:${taskId}`,
        severity: 'medium',
        category: 'dispatch_stalled',
        title: `存在可派发任务 ${taskId}`,
        explanation: '项目有无依赖可派发任务，但当前没有 agent 在执行。',
        confidence: 0.8,
        evidenceIds: [`task:${taskId}`],
    };
}
