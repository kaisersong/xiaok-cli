export function diagnoseTraceBundle(bundle) {
    const findings = [];
    const evidence = [];
    const actions = new Map();
    const blockedTasks = bundle.tasks.filter((task) => task.status === 'blocked' || task.status === 'failed');
    const allAgentsIdle = bundle.agents.length > 0 && bundle.agents.every((agent) => agent.status === 'idle' || agent.status === 'completed');
    const projectStatus = typeof bundle.summary.projectStatus === 'string' ? bundle.summary.projectStatus : undefined;
    if (blockedTasks.length > 0 && (projectStatus === 'active' || allAgentsIdle)) {
        const task = blockedTasks[0];
        findings.push({
            id: `finding:blocked_task:${task.id}`,
            severity: 'critical',
            category: 'blocked_task',
            title: `项目被任务 ${task.id} 阻塞`,
            explanation: task.blockedReason ? `任务阻塞原因：${task.blockedReason}` : '项目存在失败或阻塞任务，且没有可见运行中的 agent。',
            confidence: 0.95,
            evidenceIds: [`task:${task.id}`],
        });
        evidence.push(taskEvidence(task));
        actions.set('inspect_blocked_task', { id: 'inspect_blocked_task', label: '查看阻塞任务', recommended: true });
        actions.set('reassign_task', { id: 'reassign_task', label: '重派或更换 agent' });
        actions.set('dispatch_unblocked_task', { id: 'dispatch_unblocked_task', label: '派发无依赖任务' });
    }
    for (const task of bundle.tasks) {
        if ((task.status === 'done' || task.status === 'submitted') && (!task.artifacts || task.artifacts.length === 0)) {
            findings.push({
                id: `finding:empty_artifact:${task.id}`,
                severity: 'critical',
                category: 'empty_artifact',
                title: `任务 ${task.id} 缺少产物`,
                explanation: '任务声称完成或提交，但没有可验证产物。',
                confidence: 0.95,
                evidenceIds: [`task:${task.id}`],
            });
            evidence.push(taskEvidence(task));
            actions.set('inspect_artifacts', { id: 'inspect_artifacts', label: '检查任务产物', recommended: true });
            actions.set('rerun_with_artifact_contract', { id: 'rerun_with_artifact_contract', label: '按产物契约重跑' });
            break;
        }
    }
    const unresolvedApproval = findUnresolvedApproval(bundle.events);
    if (unresolvedApproval) {
        findings.push({
            id: `finding:approval_wait:${unresolvedApproval.id}`,
            severity: 'high',
            category: 'approval_wait',
            title: '等待用户审批',
            explanation: '最近存在审批请求，但 trace 中没有对应 resolved 事件。',
            confidence: 0.9,
            evidenceIds: [`event:${unresolvedApproval.id}`],
        });
        evidence.push({ id: `event:${unresolvedApproval.id}`, label: unresolvedApproval.type, data: unresolvedApproval.data });
        actions.set('answer_approval', { id: 'answer_approval', label: '处理审批请求', recommended: true });
    }
    const health = inferHealth(findings, bundle);
    return {
        schemaVersion: 1,
        target: { kind: bundle.scope.kind, id: bundle.scope.projectId ?? bundle.scope.sessionId ?? bundle.scope.taskId },
        generatedAt: new Date().toISOString(),
        health,
        primaryFinding: choosePrimaryFinding(findings),
        findings,
        recommendedActions: [...actions.values()],
        evidence,
    };
}
export function formatDiagnosisMarkdown(report) {
    const primary = report.primaryFinding;
    return [
        '# Xiaok Diagnosis',
        '',
        '## 主要问题',
        primary ? `- ${primary.title}：${primary.explanation}` : '- 未发现明确问题',
        '',
        '## 证据',
        ...(report.evidence.length > 0 ? report.evidence.map((item) => `- ${item.id}: ${item.label}`) : ['- 无']),
        '',
        '## 建议动作',
        ...(report.recommendedActions.length > 0 ? report.recommendedActions.map((action) => `- ${action.label}`) : ['- 无']),
        '',
        '## 其他发现',
        ...report.findings.filter((finding) => finding !== primary).map((finding) => `- ${finding.title}`),
    ].join('\n');
}
export function choosePrimaryFinding(findings) {
    const severityScore = {
        critical: 4,
        high: 3,
        medium: 2,
        low: 1,
    };
    return [...findings].sort((a, b) => {
        const severityDelta = severityScore[b.severity] - severityScore[a.severity];
        if (severityDelta !== 0)
            return severityDelta;
        return b.confidence - a.confidence;
    })[0] ?? null;
}
function inferHealth(findings, bundle) {
    if (findings.some((finding) => finding.category === 'blocked_task'))
        return 'blocked';
    if (findings.some((finding) => finding.category === 'empty_artifact'))
        return 'failed';
    if (findings.some((finding) => finding.category === 'approval_wait'))
        return 'waiting';
    if (bundle.tasks.some((task) => task.status === 'in_progress' || task.status === 'accepted'))
        return 'running';
    return findings.length > 0 ? 'unknown' : 'healthy';
}
function taskEvidence(task) {
    return {
        id: `task:${task.id}`,
        label: task.title,
        data: {
            status: task.status,
            blockedReason: task.blockedReason,
            failureCount: task.failureCount,
        },
    };
}
function findUnresolvedApproval(events) {
    const approval = [...events].reverse().find((event) => event.type === 'approval.required' || event.type === 'approval_required');
    if (!approval)
        return null;
    const resolved = events.some((event) => event.type === 'approval.resolved' || event.type === 'approval_resolved');
    return resolved ? null : approval;
}
