import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { KSwarmWorkflowProposal, ProjectFullDetail } from '../../renderer/src/hooks/useKSwarmClient';

const {
  mockGetProjectFullDetail,
  mockStartProjectDiagnoseWorkflow,
  mockStartProjectAgentReviewSmokeWorkflow,
  mockCreateWorkflowProposal,
  mockStartWorkflowRunFromProposal,
  mockCancelWorkflowRun,
  mockUpdateProjectExecutionMode,
  mockApproveProject,
  mockDispatchTasks,
  mockServiceStatus,
} = vi.hoisted(() => ({
  mockGetProjectFullDetail: vi.fn(),
  mockStartProjectDiagnoseWorkflow: vi.fn(),
  mockStartProjectAgentReviewSmokeWorkflow: vi.fn(),
  mockCreateWorkflowProposal: vi.fn(),
  mockStartWorkflowRunFromProposal: vi.fn(),
  mockCancelWorkflowRun: vi.fn(),
  mockUpdateProjectExecutionMode: vi.fn(),
  mockApproveProject: vi.fn(),
  mockDispatchTasks: vi.fn(),
  mockServiceStatus: { current: null as null | { running: boolean; port: number; pid: number | null; restartCount: number; lastError: string | null } },
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    connected: true,
    agents: [],
    getProjectFullDetail: mockGetProjectFullDetail,
    approveProject: mockApproveProject,
    retryPlan: vi.fn(),
    continueProject: vi.fn(),
    dispatchTasks: mockDispatchTasks,
    deliverProject: vi.fn(),
    closeProject: vi.fn(),
    deleteProject: vi.fn(),
    startProjectDiagnoseWorkflow: mockStartProjectDiagnoseWorkflow,
    startProjectAgentReviewSmokeWorkflow: mockStartProjectAgentReviewSmokeWorkflow,
    createWorkflowProposal: mockCreateWorkflowProposal,
    startWorkflowRunFromProposal: mockStartWorkflowRunFromProposal,
    cancelWorkflowRun: mockCancelWorkflowRun,
    updateProjectExecutionMode: mockUpdateProjectExecutionMode,
    serviceStatus: mockServiceStatus.current,
  }),
}));

vi.mock('../../renderer/src/components/projects/KanbanBoard', () => ({
  KanbanBoard: ({ onStartTaskWorkflow }: { onStartTaskWorkflow?: (taskId: string) => void }) => (
    <div>
      <div>kanban</div>
      {onStartTaskWorkflow && (
        <button type="button" onClick={() => onStartTaskWorkflow('item-1')}>用工作流执行任务</button>
      )}
    </div>
  ),
}));
vi.mock('../../renderer/src/components/projects/PlanView', () => ({
  PlanView: () => <div>plan</div>,
}));
vi.mock('../../renderer/src/components/projects/ActivityTimeline', () => ({
  ActivityTimeline: ({ workflowRuns }: { workflowRuns?: unknown[] }) => (
    <div>
      <div>activity</div>
      <div>workflow-runs-prop:{workflowRuns?.length ?? 0}</div>
    </div>
  ),
}));
vi.mock('../../renderer/src/components/projects/DeliverableView', () => ({
  DeliverableView: () => <div>deliverables</div>,
}));
vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => ({
    showSaveDialog: vi.fn(),
    saveFile: vi.fn(),
  }),
}));
vi.mock('../../renderer/src/api', () => ({
  api: { createThread: vi.fn() },
}));

import { ProjectDetailPage } from '../../renderer/src/components/projects/ProjectDetailPage';
import { WorkflowStatusStrip } from '../../renderer/src/components/projects/WorkflowStatusStrip';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockServiceStatus.current = null;
});

function renderWithProviders(ui: React.ReactNode, initialPath = '/') {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        {ui}
      </MemoryRouter>
    </LocaleProvider>
  );
}

function agentWorkflowRun() {
  return {
    id: 'wf-proj-workflow-agent-review-smoke-1770000000000',
    projectId: 'proj-workflow',
    workflowId: 'agent-review-smoke',
    title: 'Agent 工作流 smoke',
    strategy: 'workflow' as const,
    source: 'builtin-smoke',
    status: 'completed' as const,
    createdAt: 1770000000000,
    updatedAt: 1770000002000,
    startedAt: 1770000000000,
    completedAt: 1770000002000,
    cancelledAt: null,
    requestedBy: 'human',
    approval: { required: false, status: 'not_required', budget: null, approvedBy: null, decidedAt: null },
    phases: [
      { id: 'inspect', title: 'Agent 诊断', status: 'completed' as const, nodeIds: ['worker-diagnose-project'] },
      { id: 'review', title: '对抗性复核', status: 'completed' as const, nodeIds: ['reviewer-adversarial-check'] },
      { id: 'reduce', title: '门禁归约', status: 'completed' as const, nodeIds: ['reduce-review-gate'] },
    ],
    nodes: [
      {
        id: 'worker-diagnose-project',
        phaseId: 'inspect',
        title: 'Worker 项目诊断',
        status: 'completed' as const,
        kind: 'agent_task',
        dependsOn: [],
        assignedAgent: 'xiaok-worker',
        attempt: 1,
        output: { summary: '发现 1 个待执行任务' },
        error: null,
        startedAt: 1770000000000,
        completedAt: 1770000001000,
      },
      {
        id: 'reviewer-adversarial-check',
        phaseId: 'review',
        title: 'Reviewer 对抗性检查',
        status: 'completed' as const,
        kind: 'review',
        dependsOn: ['worker-diagnose-project'],
        assignedAgent: 'xiaok-po',
        attempt: 1,
        output: { summary: '通过对抗性检查' },
        reviewDecision: { status: 'passed', reason: '诊断材料可用', evidenceRefs: ['task:item-1'] },
        error: null,
        startedAt: 1770000001000,
        completedAt: 1770000002000,
      },
      {
        id: 'reduce-review-gate',
        phaseId: 'reduce',
        title: '归约 review gate',
        status: 'completed' as const,
        kind: 'control',
        dependsOn: ['reviewer-adversarial-check'],
        assignedAgent: null,
        output: { decision: { status: 'passed', reason: '诊断材料可用' } },
        error: null,
        startedAt: 1770000002000,
        completedAt: 1770000002000,
      },
    ],
    summary: { total: 3, completed: 3, failed: 0, blocked: 0, running: 0, pending: 0, progress: 1, primaryMessage: 'Review gate passed' },
    gateDecision: { status: 'passed', reason: '诊断材料可用', evidenceRefs: ['task:item-1'] },
  };
}

function taskWorkflowRun() {
  const run = agentWorkflowRun();
  return {
    ...run,
    id: 'wf-proj-workflow-po-generated-task-workflow-1770000000000',
    workflowId: 'po-generated-task-workflow',
    title: 'PO 生成任务工作流',
    source: 'po_generated',
    scope: { projectId: 'proj-workflow', taskId: 'item-1' },
    sourceTask: { id: 'item-1', title: '写报告', status: 'pending', assignedAgent: 'xiaok-worker' },
    budgets: { maxNodes: 3, maxParallelism: 1, maxAgents: 2, maxMinutes: 15, maxTokens: 16000 },
    budgetGate: {
      status: 'passed',
      hardLimits: { maxNodes: 3, maxParallelism: 1, maxAgents: 2, maxMinutes: 15, maxTokens: 16000 },
      estimate: { riskLevel: 'medium', reason: '估算只用于风险提示；KSwarm 在启动和 dispatch 前执行 hard limits。' },
    },
    progressState: {
      lastMaterialProgress: { nodeId: 'po-draft-task-plan', message: '正在生成任务工作流建议', at: 1770000000777 },
    },
    recovery: { mode: 'resume_completed_nodes', reusableNodeCount: 1, nextAction: 'resume_workflow' },
    summary: {
      total: 3,
      completed: 1,
      failed: 0,
      blocked: 0,
      running: 1,
      pending: 1,
      progress: 1 / 3,
      primaryMessage: '执行中 1/3',
      cache: { storedNodeCount: 1, reusableNodeCount: 1 },
      blockingFailures: [],
    },
    nodes: [
      {
        id: 'po-draft-task-plan',
        phaseId: 'plan',
        title: 'PO 起草任务工作流',
        status: 'completed' as const,
        kind: 'agent_task',
        dependsOn: [],
        assignedAgent: 'xiaok-po',
        attempt: 1,
        output: { summary: '已生成任务工作流建议', evidenceRefs: ['task:item-1'] },
        cache: { status: 'stored', key: 'cache-1', storedAt: 1770000001000, inputHash: 'in', outputHash: 'out' },
        error: null,
        startedAt: 1770000000000,
        completedAt: 1770000001000,
      },
      {
        id: 'reviewer-adversarial-check',
        phaseId: 'review',
        title: 'Reviewer 复核 PO 建议',
        status: 'running' as const,
        kind: 'review',
        dependsOn: ['po-draft-task-plan'],
        assignedAgent: 'xiaok-po',
        attempt: 1,
        output: null,
        reviewDecision: null,
        error: null,
      },
      {
        id: 'reduce-review-gate',
        phaseId: 'reduce',
        title: '归约 review gate',
        status: 'pending' as const,
        kind: 'control',
        dependsOn: ['reviewer-adversarial-check'],
        assignedAgent: null,
        output: null,
        error: null,
      },
    ],
  };
}

function runningAgentWorkflowRun() {
  const run = agentWorkflowRun();
  return {
    ...run,
    status: 'running' as const,
    completedAt: null,
    summary: { total: 3, completed: 0, failed: 0, blocked: 0, running: 1, pending: 2, progress: 0, primaryMessage: null },
    gateDecision: null,
    nodes: run.nodes.map((node, index) => ({
      ...node,
      status: index === 0 ? 'running' as const : 'pending' as const,
      output: null,
      reviewDecision: null,
      completedAt: null,
    })),
  };
}

function scriptParallelWorkflowRun() {
  return {
    id: 'wf-proj-workflow-script-parallel-1770000000000',
    projectId: 'proj-workflow',
    workflowId: 'parallel_report_review',
    title: '并行报告复核',
    strategy: 'workflow' as const,
    source: 'script_generated',
    status: 'completed' as const,
    createdAt: 1770000000000,
    updatedAt: 1770000004000,
    startedAt: 1770000000000,
    completedAt: 1770000004000,
    cancelledAt: null,
    requestedBy: 'assistant',
    approval: { required: true, status: 'approved', budget: null, approvedBy: 'assistant', decidedAt: 1770000000000 },
    phases: [
      { id: 'script-review', title: '并行复核', status: 'completed' as const, nodeIds: ['script-agent-1', 'script-agent-2'] },
      { id: 'script-summary', title: '汇总', status: 'completed' as const, nodeIds: ['script-runtime'] },
    ],
    parallelGroups: [
      {
        id: 'script-parallel-1',
        workflowRunId: 'wf-proj-workflow-script-parallel-1770000000000',
        phaseId: 'script-review',
        primitiveId: 'parallel-1',
        kind: 'parallel',
        label: '两路复核',
        status: 'completed',
        limit: 2,
        totalCount: 2,
        completedCount: 2,
        failedCount: 0,
        cancelledCount: 0,
        requiredFailedCount: 0,
        failurePolicy: 'required_all',
        quorum: null,
        createdAt: 1770000001000,
        updatedAt: 1770000003000,
        completedAt: 1770000003000,
      },
    ],
    scriptCheckpoints: [
      { id: 'script-checkpoint-1', workflowRunId: 'wf-proj-workflow-script-parallel-1770000000000', primitiveType: 'parallel', primitiveId: 'parallel-1', phaseId: 'script-review', parallelGroupId: 'script-parallel-1', status: 'completed', outputRefs: [], createdAt: 1770000001000, updatedAt: 1770000003000 },
      { id: 'script-checkpoint-2', workflowRunId: 'wf-proj-workflow-script-parallel-1770000000000', primitiveType: 'agent', primitiveId: 'script-agent-1', phaseId: 'script-review', parallelGroupId: 'script-parallel-1', status: 'completed', outputRefs: ['script-agent-1'], createdAt: 1770000001000, updatedAt: 1770000002000 },
      { id: 'script-checkpoint-3', workflowRunId: 'wf-proj-workflow-script-parallel-1770000000000', primitiveType: 'agent', primitiveId: 'script-agent-2', phaseId: 'script-review', parallelGroupId: 'script-parallel-1', status: 'completed', outputRefs: ['script-agent-2'], createdAt: 1770000001000, updatedAt: 1770000003000 },
    ],
    nodes: [
      {
        id: 'script-runtime',
        phaseId: 'script-summary',
        title: '动态脚本运行时',
        status: 'completed' as const,
        kind: 'control',
        dependsOn: [],
        assignedAgent: 'desktop-workflow-runtime',
        attempt: 1,
        output: { summary: '并行复核完成' },
        error: null,
        startedAt: 1770000000000,
        completedAt: 1770000004000,
      },
      {
        id: 'script-agent-1',
        phaseId: 'script-review',
        title: '格式检查',
        status: 'completed' as const,
        kind: 'agent_task',
        dependsOn: [],
        assignedAgent: 'xiaok-worker',
        attempt: 1,
        output: { summary: '格式通过' },
        error: null,
        startedAt: 1770000001000,
        completedAt: 1770000002000,
        parallelGroupId: 'script-parallel-1',
        fanoutItemKey: 'branch-1',
        fanoutItemLabel: '格式检查',
      },
      {
        id: 'script-agent-2',
        phaseId: 'script-review',
        title: '事实检查',
        status: 'completed' as const,
        kind: 'agent_task',
        dependsOn: [],
        assignedAgent: 'xiaok-worker',
        attempt: 1,
        output: { summary: '事实通过' },
        error: null,
        startedAt: 1770000001000,
        completedAt: 1770000003000,
        parallelGroupId: 'script-parallel-1',
        fanoutItemKey: 'branch-2',
        fanoutItemLabel: '事实检查',
      },
    ],
    summary: {
      total: 3,
      completed: 3,
      failed: 0,
      blocked: 0,
      running: 0,
      pending: 0,
      progress: 1,
      primaryMessage: '并行复核完成',
      parallelGroups: { total: 1, completed: 1, failed: 0, blocked: 0, running: 0, cancelled: 0 },
      checkpoints: { total: 3, completed: 3, waiting: 0, failed: 0 },
      blockingFailures: [],
    },
    gateDecision: null,
    projectDelivery: {
      status: 'delivered',
      deliveredAt: 1770000004000,
      projectId: 'proj-workflow',
      workflowRunId: 'wf-proj-workflow-script-parallel-1770000000000',
      taskCount: 1,
    },
  };
}

function blockedScriptParallelWorkflowRun() {
  return {
    ...scriptParallelWorkflowRun(),
    status: 'blocked' as const,
    completedAt: null,
    summary: {
      ...scriptParallelWorkflowRun().summary,
      completed: 4,
      blocked: 1,
      running: 1,
      progress: 4 / 6,
      primaryMessage: null,
      blockingFailures: [
        { nodeId: 'script-agent-4', title: 'AI基础设施与芯片', status: 'blocked', reason: 'structured_json_missing' },
      ],
    },
    recovery: { mode: 'resume_completed_nodes', reusableNodeCount: 4, nextAction: 'resume_workflow' },
    parallelGroups: [
      {
        ...scriptParallelWorkflowRun().parallelGroups[0],
        status: 'failed',
        totalCount: 5,
        completedCount: 4,
        requiredFailedCount: 1,
      },
    ],
    nodes: [
      {
        id: 'script-runtime',
        phaseId: 'script-runtime',
        title: '动态工作流编排',
        status: 'running' as const,
        kind: 'script_runtime',
        dependsOn: [],
        assignedAgent: 'desktop-workflow-runtime',
        attempt: 1,
        output: null,
        error: null,
      },
      {
        id: 'script-agent-4',
        phaseId: 'phase-1',
        title: 'AI基础设施与芯片',
        status: 'blocked' as const,
        kind: 'agent_task',
        dependsOn: [],
        assignedAgent: 'xiaok-worker',
        attempt: 1,
        output: null,
        error: 'structured_json_missing',
        parallelGroupId: 'script-parallel-1',
        fanoutItemKey: 'branch-4',
        fanoutItemLabel: 'AI基础设施与芯片',
      },
    ],
  };
}

function agentWorkflowProposal(): KSwarmWorkflowProposal {
  return {
    id: 'wfp-proj-workflow-agent-review-smoke-1770000000000',
    projectId: 'proj-workflow',
    workflowId: 'agent-review-smoke',
    title: 'Agent 复核诊断',
    description: 'Worker Agent 诊断项目，Reviewer Agent 对抗性复核，并由 KSwarm gate reducer 归约。',
    goal: 'Worker Agent 诊断项目，Reviewer Agent 对抗性复核，并由 KSwarm gate reducer 归约。',
    status: 'pending',
    requestedBy: 'human',
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    specHash: 'sha256:proposal',
    phases: [
      { id: 'inspect', title: 'Agent 诊断', nodes: [{ id: 'worker-diagnose-project', title: 'Worker 项目诊断', kind: 'agent', required: true, dependsOn: [] }] },
      { id: 'review', title: '对抗性复核', nodes: [{ id: 'reviewer-adversarial-check', title: 'Reviewer 对抗性检查', kind: 'review', required: true, dependsOn: ['worker-diagnose-project'] }] },
      { id: 'reduce', title: '门禁归约', nodes: [{ id: 'reduce-review-gate', title: '归约 review gate', kind: 'reduce', required: true, dependsOn: ['reviewer-adversarial-check'] }] },
    ],
    budgets: { maxNodes: 3, maxParallelism: 1, maxAgents: 2, maxMinutes: 10, maxTokens: 12000 },
    permissions: { toolCategories: ['read_project_state'], allowWrite: false, allowShell: false, allowNetwork: false, allowRenderer: false },
    outputContract: { kind: 'diagnosis', requiredArtifactTypes: [] },
    assumptions: [
      'Worker 只诊断项目状态和任务阻塞，不修改项目计划',
      'Reviewer 只产出结构化 reviewDecision，不直接改变任务或产物状态',
    ],
    acceptanceRubric: {
      id: 'agent-review-diagnosis-rubric',
      title: 'Agent 复核诊断验收标准',
      machineChecks: [{ id: 'worker_output_schema', title: 'Worker 输出结构合法', checkKind: 'schema', required: true, inputRefs: ['worker-diagnose-project.output'] }],
      judgmentChecks: [{ id: 'review_evidence', title: '复核结论有证据', prompt: '检查 reviewer 是否引用证据。', evidenceRequired: true, reviewerCount: 1, required: true }],
      disagreementPolicy: 'block',
    },
    approval: { required: true, status: 'pending', budget: { maxNodes: 3, maxParallelism: 1, maxAgents: 2, maxMinutes: 10, maxTokens: 12000 }, approvedBy: null, decidedAt: null },
  };
}

function taskWorkflowProposal(): KSwarmWorkflowProposal {
  return {
    ...agentWorkflowProposal(),
    id: 'wfp-proj-workflow-po-generated-task-workflow-1770000000000',
    workflowId: 'po-generated-task-workflow',
    title: 'PO 生成任务工作流',
    description: 'PO 根据任务「写报告」生成受控工作流建议，执行前需要用户确认。',
    goal: 'PO 根据任务「写报告」生成受控工作流建议，执行前需要用户确认。',
    source: 'po_generated',
    scope: { projectId: 'proj-workflow', taskId: 'item-1' },
    sourceTask: { id: 'item-1', title: '写报告', status: 'pending', assignedAgent: 'xiaok-worker' },
    budgets: { maxNodes: 3, maxParallelism: 1, maxAgents: 2, maxMinutes: 15, maxTokens: 16000 },
    budgetGate: {
      status: 'passed',
      hardLimits: { maxNodes: 3, maxParallelism: 1, maxAgents: 2, maxMinutes: 15, maxTokens: 16000 },
      estimate: { riskLevel: 'medium', reason: '估算只用于风险提示；KSwarm 在启动和 dispatch 前执行 hard limits。' },
    },
    phases: [
      { id: 'plan', title: 'PO 生成建议', nodes: [{ id: 'po-draft-task-plan', title: 'PO 起草任务工作流', kind: 'agent', required: true, dependsOn: [] }] },
      { id: 'review', title: '对抗性复核', nodes: [{ id: 'reviewer-adversarial-check', title: 'Reviewer 复核 PO 建议', kind: 'review', required: true, dependsOn: ['po-draft-task-plan'] }] },
      { id: 'reduce', title: '门禁归约', nodes: [{ id: 'reduce-review-gate', title: '归约 review gate', kind: 'reduce', required: true, dependsOn: ['reviewer-adversarial-check'] }] },
    ],
    acceptanceRubric: {
      id: 'po-generated-task-workflow-rubric',
      title: 'PO 生成任务工作流验收标准',
      machineChecks: [{ id: 'po_plan_schema', title: 'PO 计划输出结构合法', checkKind: 'schema', required: true, inputRefs: ['po-draft-task-plan.output'] }],
      judgmentChecks: [{ id: 'task_scope_evidence', title: '任务范围和证据充分', prompt: '检查证据。', evidenceRequired: true, reviewerCount: 1, required: true }],
      disagreementPolicy: 'block',
    },
    approval: { required: true, status: 'pending', budget: { maxNodes: 3, maxParallelism: 1, maxAgents: 2, maxMinutes: 15, maxTokens: 16000 }, approvedBy: null, decidedAt: null },
  } as KSwarmWorkflowProposal;
}

function workflowDetail(overrides: Partial<ProjectFullDetail> = {}): ProjectFullDetail {
  return {
    project: {
      id: 'proj-workflow',
      name: '动态工作流项目',
      goal: '验证项目级 workflow',
      status: 'active',
      executionMode: 'direct',
      poAgent: 'xiaok-po',
      createdAt: '1770000000000',
      updatedAt: '1770000000000',
    },
    tasks: [{ id: 'item-1', title: '写报告', status: 'pending', assignedAgent: 'xiaok-worker' }],
    activities: [],
    humanActions: [],
    workspace: { path: '/tmp/proj-workflow', artifacts: [] },
    plan: null,
    planProgress: null,
    workflowRuns: [
      {
        id: 'wf-proj-workflow-project-diagnose-1770000000000',
        projectId: 'proj-workflow',
        workflowId: 'project-diagnose',
        title: '项目诊断工作流',
        strategy: 'workflow',
        source: 'builtin',
        status: 'completed',
        createdAt: 1770000000000,
        updatedAt: 1770000000000,
        startedAt: 1770000000000,
        completedAt: 1770000000000,
        cancelledAt: null,
        requestedBy: 'human',
        approval: { required: false, status: 'not_required', budget: null, approvedBy: null, decidedAt: null },
        phases: [
          { id: 'inspect', title: '检查项目状态', status: 'completed', nodeIds: ['collect-project-state', 'classify-blockers'] },
          { id: 'recommend', title: '生成处理建议', status: 'completed', nodeIds: ['recommend-actions'] },
        ],
        nodes: [
          { id: 'collect-project-state', phaseId: 'inspect', title: '收集项目状态', status: 'completed', kind: 'control', dependsOn: [], output: { projectStatus: 'active', taskCount: 1, healthState: 'dispatchable' }, error: null, startedAt: 1770000000000, completedAt: 1770000000000 },
          { id: 'classify-blockers', phaseId: 'inspect', title: '识别阻塞与等待原因', status: 'completed', kind: 'control', dependsOn: ['collect-project-state'], output: { blockedTasks: [], waitingCount: 0, dispatchableCount: 1 }, error: null, startedAt: 1770000000000, completedAt: 1770000000000 },
          { id: 'recommend-actions', phaseId: 'recommend', title: '生成下一步建议', status: 'completed', kind: 'review', dependsOn: ['classify-blockers'], output: { recommendedActions: [{ id: 'dispatch_tasks', label: '派发可执行任务', reason: '存在可派发任务' }] }, error: null, startedAt: 1770000000000, completedAt: 1770000000000 },
        ],
        summary: { total: 3, completed: 3, failed: 0, blocked: 0, running: 0, pending: 0, progress: 1, primaryMessage: '派发可执行任务' },
        diagnosis: {
          healthState: 'dispatchable',
          gate: null,
          blockedTasks: [],
          dispatchableCount: 1,
          waitingCount: 0,
          recommendedActions: [{ id: 'dispatch_tasks', label: '派发可执行任务', reason: '存在可派发任务' }],
        },
      },
    ],
    ...overrides,
  };
}

function renderProjectDetail(detail: ProjectFullDetail) {
  mockGetProjectFullDetail.mockResolvedValue(detail);
  renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
    </Routes>,
    `/projects/${detail.project.id}`
  );
}

describe('WorkflowStatusStrip', () => {
  it('renders compact workflow status and opens diagnosis details on demand', () => {
    const detail = workflowDetail();

    renderWithProviders(
      <WorkflowStatusStrip
        workflowRun={detail.workflowRuns?.[0] ?? null}
        busy={false}
        onStartDiagnose={vi.fn()}
      />
    );

    expect(screen.getByText('系统诊断完成')).toBeInTheDocument();
    expect(screen.getByText('可派发')).toBeInTheDocument();
    expect(screen.getByText('1 个任务')).toBeInTheDocument();
    expect(screen.getByText('无阻塞')).toBeInTheDocument();
    expect(screen.queryByText('项目状态')).not.toBeInTheDocument();
    expect(screen.queryByText('系统内置，未调用智能体')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行工作流' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '运行系统诊断' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '运行 Agent 工作流' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /系统诊断完成/ }));

    const dialog = screen.getByRole('dialog', { name: '系统诊断详情' });
    expect(dialog.className).toContain('bg-[var(--c-bg-card)]');
    expect(dialog.className).not.toContain('/10');
    expect(screen.getByText('已完成 3/3')).toBeInTheDocument();
    expect(screen.getByText('系统内置，未调用智能体')).toBeInTheDocument();
    expect(screen.getAllByText('派发可执行任务').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('项目状态')).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('健康状态')).toBeInTheDocument();
    expect(screen.getAllByText('可派发').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/建议：/)).toBeInTheDocument();
    expect(screen.getByText(/存在可派发任务/)).toBeInTheDocument();
    expect(screen.getByText(/诊断依据：收集项目状态 ✓/)).toBeInTheDocument();
  });

  it('renders agent workflow node agents and review gate decision', () => {
    renderWithProviders(
      <WorkflowStatusStrip
        workflowRun={agentWorkflowRun()}
        busy={false}
        onStartDiagnose={vi.fn()}
        onStartAgentWorkflow={vi.fn()}
      />
    );

    expect(screen.getByText('Agent 复核诊断')).toBeInTheDocument();
    expect(screen.queryByText('Agent 工作流 smoke')).not.toBeInTheDocument();
    expect(screen.getAllByText('Review gate passed').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: /Agent 复核诊断/ }));

    const dialog = screen.getByRole('dialog', { name: 'Agent 复核诊断详情' });
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toContain('bg-[var(--c-bg-card)]');
    expect(dialog.className).not.toContain('/10');
    expect(dialog.className).toContain('left-0');
    expect(dialog.className).not.toContain('right-0');
    expect(screen.getByText('执行方式：工作流执行')).toBeInTheDocument();
    expect(screen.getByText('参与 Agent：xiaok-worker / xiaok-po')).toBeInTheDocument();
    expect(screen.getByText('Worker 项目诊断')).toBeInTheDocument();
    expect(screen.getByText('xiaok-worker')).toBeInTheDocument();
    expect(screen.getByText('Reviewer 对抗性检查')).toBeInTheDocument();
    expect(screen.getByText('xiaok-po')).toBeInTheDocument();
    expect(screen.getByText(/Gate：passed/)).toBeInTheDocument();
    expect(screen.getByText(/诊断材料可用/)).toBeInTheDocument();
  });

  it('labels running agent workflow progress as executing', () => {
    renderWithProviders(
      <WorkflowStatusStrip
        workflowRun={runningAgentWorkflowRun()}
        busy={false}
        onStartDiagnose={vi.fn()}
        onStartAgentWorkflow={vi.fn()}
      />
    );

    expect(screen.getByText('Agent 复核诊断')).toBeInTheDocument();
    expect(screen.getByText('执行中 0/3')).toBeInTheDocument();
  });

  it('shows workflow cache, recovery, task scope, and last material progress without user-facing budget details', () => {
    renderWithProviders(
      <WorkflowStatusStrip
        workflowRun={taskWorkflowRun()}
        busy={false}
        onStartDiagnose={vi.fn()}
        onStartAgentWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /PO 生成任务工作流/ }));

    const dialog = screen.getByRole('dialog', { name: '工作流详情' });
    expect(dialog).toHaveTextContent('任务：写报告');
    expect(dialog).not.toHaveTextContent('预算上限');
    expect(dialog).not.toHaveTextContent('2 Agent');
    expect(dialog).not.toHaveTextContent('16000 tokens');
    expect(dialog).toHaveTextContent('已保存节点结果 1');
    expect(dialog).toHaveTextContent('恢复方式：复用已完成节点');
    expect(dialog).toHaveTextContent('最近进展：正在生成任务工作流建议');
  });

  it('shows durable parallel groups and script checkpoints for dynamic workflow scripts', () => {
    renderWithProviders(
      <WorkflowStatusStrip
        workflowRun={scriptParallelWorkflowRun()}
        busy={false}
        onStartDiagnose={vi.fn()}
        onStartAgentWorkflow={vi.fn()}
      />
    );

    expect(screen.getByText('并行报告复核')).toBeInTheDocument();
    expect(screen.getByText('并行复核完成')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /并行报告复核/ }));

    const dialog = screen.getByRole('dialog', { name: '工作流详情' });
    expect(dialog.className).toContain('max-h-[min(72vh,640px)]');
    expect(dialog.className).toContain('overflow-y-auto');
    expect(dialog).toHaveTextContent('脚本检查点：3/3');
    expect(dialog).toHaveTextContent('并行编排');
    expect(dialog).toHaveTextContent('两路复核');
    expect(dialog).toHaveTextContent('完成 2/2');
    expect(dialog).toHaveTextContent('策略：全部必需');
    expect(dialog).toHaveTextContent('分支：格式检查 / 事实检查');
    expect(dialog).toHaveTextContent('并行分支：格式检查');
    expect(dialog).toHaveTextContent('并行分支：事实检查');
  });

  it('does not present completed script workflow without project delivery as finished project work', () => {
    const workflowRun = {
      ...scriptParallelWorkflowRun(),
      summary: {
        ...scriptParallelWorkflowRun().summary,
        primaryMessage: null,
      },
      projectDelivery: null,
      scriptResult: { summary: '动态 workflow 已运行完，但没有交付产物。' },
    };

    renderWithProviders(
      <WorkflowStatusStrip
        workflowRun={workflowRun}
        busy={false}
        onStartDiagnose={vi.fn()}
        onStartAgentWorkflow={vi.fn()}
      />
    );

    expect(screen.getByText('执行完成，待确认交付物')).toBeInTheDocument();
    expect(screen.queryByText('已完成 3/3')).not.toBeInTheDocument();
  });

  it('opens one workflow run menu for quick diagnose and agent review diagnose', () => {
    const onStartDiagnose = vi.fn();
    const onStartAgentWorkflow = vi.fn();

    renderWithProviders(
      <WorkflowStatusStrip
        workflowRun={null}
        busy={false}
        onStartDiagnose={onStartDiagnose}
        onStartAgentWorkflow={onStartAgentWorkflow}
      />
    );

    expect(screen.getByText('最近工作流：尚未运行')).toBeInTheDocument();
    const menuButton = screen.getByRole('button', { name: '运行工作流' });
    fireEvent.click(menuButton);

    const menu = screen.getByRole('menu', { name: '选择工作流' });
    expect(menu.className).toContain('bg-[var(--c-bg-card)]');
    expect(menu.className).not.toContain('/10');
    expect(within(menu).getByText('快速诊断')).toBeInTheDocument();
    expect(within(menu).getByText(/系统内置，不调用智能体/)).toBeInTheDocument();
    expect(within(menu).getByText('Agent 复核诊断')).toBeInTheDocument();
    expect(within(menu).getByText(/Reviewer Agent 对抗性复核/)).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole('menuitem', { name: /快速诊断/ }));
    expect(onStartDiagnose).toHaveBeenCalledTimes(1);
    expect(onStartAgentWorkflow).not.toHaveBeenCalled();

    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole('menuitem', { name: /Agent 复核诊断/ }));
    expect(onStartAgentWorkflow).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectDetailPage workflow action', () => {
  it('shows a success notice when project approval succeeds', async () => {
    const initial = workflowDetail({
      project: {
        ...workflowDetail().project,
        status: 'planning',
      },
    });
    const refreshed = workflowDetail({
      project: {
        ...workflowDetail().project,
        status: 'active',
      },
    });
    mockGetProjectFullDetail.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);
    mockApproveProject.mockResolvedValue(true);

    renderWithProviders(
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>,
      '/projects/proj-workflow'
    );

    fireEvent.click(await screen.findByRole('button', { name: '审批' }));

    await waitFor(() => expect(mockApproveProject).toHaveBeenCalledWith('proj-workflow'));
    expect(await screen.findByRole('status')).toHaveTextContent('审批已通过，可分发任务。');
  });

  it('shows a visible error when project approval is blocked', async () => {
    const detail = workflowDetail({
      project: {
        ...workflowDetail().project,
        status: 'planning',
      },
    });
    mockGetProjectFullDetail.mockResolvedValue(detail);
    mockApproveProject.mockResolvedValue(false);

    renderProjectDetail(detail);

    fireEvent.click(await screen.findByRole('button', { name: '审批' }));

    await waitFor(() => expect(mockApproveProject).toHaveBeenCalledWith('proj-workflow'));
    expect(await screen.findByText('审批失败：项目准备未完成，请检查智能体状态或重新制定计划。')).toBeInTheDocument();
  });

  it('prioritizes a blocked script workflow over stale project approval actions', async () => {
    const detail = workflowDetail({
      project: {
        ...workflowDetail().project,
        status: 'planning',
        executionMode: 'workflow_preferred',
      },
      plan: {
        version: 1,
        phases: [{ id: 'phase-1', name: '阶段一', items: [] }],
      } as any,
      workflowRuns: [blockedScriptParallelWorkflowRun() as any],
    });
    mockGetProjectFullDetail.mockResolvedValue(detail);

    renderProjectDetail(detail);

    expect(await screen.findByText('并行报告复核')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '审批' })).not.toBeInTheDocument();
    expect(screen.queryByText(/可审批/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /并行报告复核/ }));
    const dialog = screen.getByRole('dialog', { name: '工作流详情' });
    expect(dialog).toHaveTextContent('阻塞失败');
    expect(dialog).toHaveTextContent('AI基础设施与芯片 · structured_json_missing');
    expect(dialog).toHaveTextContent('恢复方式：复用已完成节点');
  });

  it('shows a success notice when dispatch starts task workflows', async () => {
    const initial = workflowDetail({
      project: {
        ...workflowDetail().project,
        status: 'active',
        executionMode: 'workflow_preferred',
      },
      workflowRuns: [],
    });
    const refreshed = workflowDetail({
      project: {
        ...workflowDetail().project,
        status: 'active',
        executionMode: 'workflow_preferred',
      },
      workflowRuns: [taskWorkflowRun()],
    });
    mockGetProjectFullDetail.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);
    mockDispatchTasks.mockResolvedValue({
      dispatched: [],
      workflowRuns: [{ id: 'wf-proj-workflow-po-generated-task-workflow-1770000000000' }],
      workflowNodeDispatches: [{ workflowRunId: 'wf-proj-workflow-po-generated-task-workflow-1770000000000', nodeId: 'worker-produce-deliverable' }],
    });

    renderWithProviders(
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>,
      '/projects/proj-workflow'
    );

    fireEvent.click(await screen.findByRole('button', { name: '分发任务' }));

    await waitFor(() => expect(mockDispatchTasks).toHaveBeenCalledWith('proj-workflow', 'xiaok-po'));
    expect(await screen.findByRole('status')).toHaveTextContent('已启动任务工作流，正在生成交付物。');
  });

  it('starts project diagnose workflow and refreshes project detail', async () => {
    const initial = workflowDetail({ workflowRuns: [] });
    const refreshed = workflowDetail();
    mockGetProjectFullDetail.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);
    mockStartProjectDiagnoseWorkflow.mockResolvedValue(refreshed.workflowRuns?.[0]);

    renderProjectDetail(initial);

    fireEvent.click(await screen.findByRole('button', { name: '运行工作流' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /快速诊断/ }));

    await waitFor(() => expect(mockStartProjectDiagnoseWorkflow).toHaveBeenCalledWith('proj-workflow'));
    await waitFor(() => expect(mockGetProjectFullDetail).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('系统诊断完成')).toBeInTheDocument();
    expect(screen.queryByText('项目状态')).not.toBeInTheDocument();
  });

  it('shows completed workflow from the start response even when detail refresh is stale', async () => {
    const initial = workflowDetail({ workflowRuns: [] });
    const completedRun = workflowDetail().workflowRuns?.[0];
    mockGetProjectFullDetail.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial);
    mockStartProjectDiagnoseWorkflow.mockResolvedValue(completedRun);

    renderProjectDetail(initial);

    fireEvent.click(await screen.findByRole('button', { name: '运行工作流' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /快速诊断/ }));

    await waitFor(() => expect(mockStartProjectDiagnoseWorkflow).toHaveBeenCalledWith('proj-workflow'));
    expect(await screen.findByText('快速诊断已完成。')).toBeInTheDocument();
    expect(await screen.findByText('系统诊断完成')).toBeInTheDocument();
    expect(screen.queryByText('系统内置，未调用智能体')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /系统诊断完成/ }));
    expect(screen.getByText('系统内置，未调用智能体')).toBeInTheDocument();
    expect(screen.getAllByText('派发可执行任务').length).toBeGreaterThanOrEqual(1);
  });

  it('starts agent-backed workflow smoke from project detail', async () => {
    const initial = workflowDetail({ workflowRuns: [] });
    const proposal = agentWorkflowProposal();
    const smokeRun = agentWorkflowRun();
    mockGetProjectFullDetail.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial);
    mockCreateWorkflowProposal.mockResolvedValue(proposal);
    mockStartWorkflowRunFromProposal.mockResolvedValue(smokeRun);

    renderProjectDetail(initial);

    fireEvent.click(await screen.findByRole('button', { name: '运行工作流' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Agent 复核诊断/ }));

    await waitFor(() => expect(mockCreateWorkflowProposal).toHaveBeenCalledWith('proj-workflow', 'agent-review-smoke'));
    expect(mockStartProjectAgentReviewSmokeWorkflow).not.toHaveBeenCalled();
    expect(mockStartWorkflowRunFromProposal).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: '工作流执行确认' });
    expect(dialog.className).toContain('bg-[var(--c-bg-card)]');
    expect(dialog.className).not.toContain('/10');
    expect(dialog.className).toContain('left-0');
    expect(dialog.className).not.toContain('right-0');
    expect(dialog).toHaveTextContent('Agent 复核诊断');
    expect(dialog).toHaveTextContent('目标');
    expect(dialog).toHaveTextContent('Agent 复核诊断验收标准');
    expect(dialog).toHaveTextContent('Worker 输出结构合法');
    expect(dialog).toHaveTextContent('复核结论有证据');
    expect(dialog).not.toHaveTextContent('最大节点');
    expect(dialog).not.toHaveTextContent('最大并发');
    expect(dialog).not.toHaveTextContent('读取项目状态');

    fireEvent.click(within(dialog).getByRole('button', { name: '运行一次' }));

    await waitFor(() => expect(mockStartWorkflowRunFromProposal).toHaveBeenCalledWith('proj-workflow', 'agent-review-smoke', proposal.id));
    expect(await screen.findByText('Agent 复核诊断已启动。')).toBeInTheDocument();
    expect(await screen.findByText('Agent 复核诊断')).toBeInTheDocument();
    expect(screen.queryByText('Agent 工作流 smoke')).not.toBeInTheDocument();
  });

  it('creates and confirms a task-level PO-generated workflow proposal from the board', async () => {
    const initial = workflowDetail({ workflowRuns: [] });
    const proposal = taskWorkflowProposal();
    const run = taskWorkflowRun();
    mockGetProjectFullDetail.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial);
    mockCreateWorkflowProposal.mockResolvedValue(proposal);
    mockStartWorkflowRunFromProposal.mockResolvedValue(run);

    renderProjectDetail(initial);

    fireEvent.click(await screen.findByRole('button', { name: '用工作流执行任务' }));

    await waitFor(() => expect(mockCreateWorkflowProposal).toHaveBeenCalledWith('proj-workflow', 'po-generated-task-workflow', { taskId: 'item-1' }));
    const dialog = await screen.findByRole('dialog', { name: '工作流执行确认' });
    expect(dialog).toHaveTextContent('PO 生成任务工作流');
    expect(dialog).toHaveTextContent('任务：写报告');
    expect(dialog).toHaveTextContent('PO 生成任务工作流验收标准');
    expect(dialog).not.toHaveTextContent('预算硬上限');
    expect(dialog).not.toHaveTextContent('16000 tokens');

    fireEvent.click(within(dialog).getByRole('button', { name: '运行一次' }));

    await waitFor(() => expect(mockStartWorkflowRunFromProposal).toHaveBeenCalledWith('proj-workflow', 'po-generated-task-workflow', proposal.id, { taskId: 'item-1' }));
    expect(await screen.findByText('任务工作流已启动。')).toBeInTheDocument();
    expect(await screen.findByText('PO 生成任务工作流')).toBeInTheDocument();
  });

  it('cancels a running workflow from the workflow details', async () => {
    const detail = workflowDetail({ workflowRuns: [runningAgentWorkflowRun()] });
    mockGetProjectFullDetail.mockResolvedValue(detail);
    mockCancelWorkflowRun.mockResolvedValue({ ...runningAgentWorkflowRun(), status: 'cancelled', summary: { ...runningAgentWorkflowRun().summary, primaryMessage: '已取消' } });

    renderProjectDetail(detail);

    fireEvent.click(await screen.findByRole('button', { name: /Agent 复核诊断/ }));
    const dialog = screen.getByRole('dialog', { name: 'Agent 复核诊断详情' });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消工作流' }));

    await waitFor(() => expect(mockCancelWorkflowRun).toHaveBeenCalledWith('proj-workflow', runningAgentWorkflowRun().id));
    expect(await screen.findByText('工作流已取消。')).toBeInTheDocument();
  });

  it('labels the project detail tab as logs and sends workflow runs into the fused timeline', async () => {
    const detail = workflowDetail({ workflowRuns: [agentWorkflowRun(), ...(workflowDetail().workflowRuns ?? [])] });
    mockGetProjectFullDetail.mockResolvedValue(detail);

    renderProjectDetail(detail);

    const logTab = await screen.findByRole('button', { name: '日志' });
    expect(logTab).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '工作流' })).not.toBeInTheDocument();
    fireEvent.click(logTab);

    expect(await screen.findByText('activity')).toBeInTheDocument();
    expect(screen.getByText('workflow-runs-prop:2')).toBeInTheDocument();
    expect(screen.queryByText('工作流运行记录')).not.toBeInTheDocument();
  });

  it('keeps project execution mode as a compact project setting in the tab row', async () => {
    const initial = workflowDetail({ workflowRuns: [] });
    mockGetProjectFullDetail.mockResolvedValue(initial);
    mockUpdateProjectExecutionMode.mockResolvedValue({ ...initial.project, executionMode: 'auto' });

    renderProjectDetail(initial);

    const tabRow = await screen.findByTestId('project-detail-tab-row');
    const control = within(tabRow).getByRole('group', { name: '项目执行方式' });
    expect(within(control).getByRole('button', { name: '快速执行' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(control).getByRole('button', { name: '智能选择' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(within(control).getByRole('button', { name: '智能选择' }));

    await waitFor(() => expect(mockUpdateProjectExecutionMode).toHaveBeenCalledWith('proj-workflow', 'auto'));
    expect(await screen.findByText('已切换为智能选择。')).toBeInTheDocument();
    expect(within(control).getByRole('button', { name: '智能选择' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the workflow entry visible in the project detail tab row', async () => {
    const detail = workflowDetail({ workflowRuns: [] });
    mockGetProjectFullDetail.mockResolvedValue(detail);

    renderProjectDetail(detail);

    const tabRow = await screen.findByTestId('project-detail-tab-row');
    const workflowEntry = within(tabRow).getByTestId('project-detail-workflow-entry');
    expect(within(workflowEntry).getByRole('button', { name: '运行工作流' })).toBeInTheDocument();
    expect(within(tabRow).getByRole('button', { name: '日志' })).toBeInTheDocument();
    expect(within(tabRow).getByText('最近工作流：尚未运行')).toBeInTheDocument();
  });

  it('disables workflow actions when desktop is connected to an incompatible old KSwarm service', async () => {
    const detail = workflowDetail({ workflowRuns: [] });
    mockGetProjectFullDetail.mockResolvedValue(detail);
    mockServiceStatus.current = {
      running: false,
      port: 4400,
      pid: null,
      restartCount: 0,
      lastError: 'existing kswarm service on port 4400 does not support dynamic workflows',
    };

    renderProjectDetail(detail);

    const workflowEntry = within(await screen.findByTestId('project-detail-tab-row')).getByTestId('project-detail-workflow-entry');
    expect(within(workflowEntry).getByText('工作流服务版本过旧，请关闭旧版小K并重启当前版本。')).toBeInTheDocument();
    expect(within(workflowEntry).getByRole('button', { name: '运行工作流' })).toBeDisabled();

    fireEvent.click(within(workflowEntry).getByRole('button', { name: '运行工作流' }));
    expect(screen.queryByRole('menu', { name: '选择工作流' })).not.toBeInTheDocument();
  });
});
