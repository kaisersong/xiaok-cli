import { diagnoseTraceBundle } from './diagnoser.js';
import type { DiagnosisFinding, DiagnosisReport } from './types.js';
import type { TraceBundleV1, TraceTask } from '../trace/schema.js';

export function diagnoseProjectSnapshot(input: ProjectSnapshot): DiagnosisReport {
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
  const bundle: TraceBundleV1 = {
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

function dispatchStalledFinding(taskId: string): DiagnosisFinding {
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

interface ProjectSnapshot {
  project: { id: string; name: string; status: string };
  tasks: Array<TraceTask & { qualityFailureCount?: number }>;
  agents?: Array<{ id: string; name?: string; status: string; currentTask?: string }>;
  activities?: unknown[];
  humanActions?: unknown[];
  dispatchPlan?: {
    dispatchable?: Array<{ taskId: string; reason?: string; agentId?: string }>;
    blocked?: Array<{ taskId: string; reason: string; blockedByTaskId?: string }>;
    waiting?: Array<{ taskId: string; reason: string; agentId?: string }>;
  };
  projectHealth?: {
    status: string;
    primaryBlockedTaskId?: string;
    message?: string;
  };
}
